const express = require("express");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");

const app = express();
const dotenv = require("dotenv");
dotenv.config();
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

app.use(
  cors({
    origin: ['http://localhost:3000', process.env.CLIENT_URL || '*'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  })
);
app.use(express.json());

const uri = process.env.MONGODB_URI;
const port = process.env.PORT || 5000;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
const clientUrl = process.env.CLIENT_URL;
const JWKS = createRemoteJWKSet(new URL(`${clientUrl}/api/auth/jwks`));


async function run() {
  try {
    // 1. Establish Database Connection
    await client.connect();
    const db = client.db("digitallessons");
    const lessonsCollection = db.collection("lessons");

    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );

    // 2. Define API Routes

  const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: No token provided",
      });
    }

    const token = authHeader.split(" ")[1];

    const { payload } = await jwtVerify(token, JWKS, {
      issuer: clientUrl,
      audience: clientUrl,
    });

    // Attach decoded user payload to request
    req.user = payload;
    next();
  } catch (error) {
    console.error("Token verification failed:", error.message);
    return res.status(401).json({
      success: false,
      message: "Unauthorized: Invalid or expired token",
      error: error.message,
    });
  }
};
    // --- ADD LESSON ---
    // --- CREATE / ADD LESSON (Auto-reviewed ONLY for Admins) ---
    app.post('/api/add-lesson',verifyToken, async (req, res) => {
      try {
        const lesson = req.body;
        const usersCollection = db.collection("user");

        // 1. Verify creator role in the database
        let isAdmin = false;
        if (lesson.creatorId) {
          const userQuery = {
            $or: [
              { _id: lesson.creatorId },
              ...(ObjectId.isValid(lesson.creatorId) ? [{ _id: new ObjectId(lesson.creatorId) }] : [])
            ]
          };
          const userDoc = await usersCollection.findOne(userQuery);
          isAdmin = userDoc?.role === "admin";
        }

        // 2. Build lesson payload: isReviewed is TRUE only if the author is an Admin
        const newLesson = {
          title: lesson.title,
          description: lesson.description,
          category: lesson.category,
          emotionalTone: lesson.emotionalTone || "Motivational",
          visibility: lesson.visibility || "Public",
          accessLevel: lesson.accessLevel || "Free",
          creatorId: lesson.creatorId || null,
          coverImage: lesson.coverImage || "",
          likes: [],
          likesCount: 0,
          savedBy: [],
          isFeatured: isAdmin ? Boolean(lesson.isFeatured) : false,
          isReviewed: isAdmin, // TRUE only for admins, FALSE for regular users
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await lessonsCollection.insertOne(newLesson);
        res.status(201).send({ 
          success: true, 
          insertedId: result.insertedId,
          isReviewed: newLesson.isReviewed 
        });

      } catch (error) {
        console.error("Error adding lesson:", error);
        res.status(500).send({ 
          success: false, 
          message: "Failed to create lesson", 
          error: error.message 
        });
      }
    });

    // --- GET MY LESSONS ---
    // --- GET MY LESSONS (All lessons including pending review) ---
    // In server.js
app.get("/api/my-lessons/:creatorId",verifyToken, async (req, res) => {
  try {
    const { creatorId } = req.params;

    const query = {
      $or: [
        { creatorId: creatorId },
        { userId: creatorId },
        ...(ObjectId.isValid(creatorId)
          ? [
              { creatorId: new ObjectId(creatorId) },
              { userId: new ObjectId(creatorId) },
            ]
          : []),
      ],
    };

    const lessons = await lessonsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).send(lessons);
  } catch (error) {
    res.status(500).send({ success: false, message: error.message });
  }
});

    // --- UPDATE LESSON ---
    app.patch('/api/update-lesson/:id',verifyToken, async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ success: false, message: "Invalid lesson ID format" });
        }

        const updateFields = { updatedAt: new Date() };
        const allowedFields = [
          'title', 
          'description', 
          'category', 
          'emotionalTone', 
          'visibility', 
          'accessLevel', 
          'coverImage',
          'isFeatured',
          'isReviewed'
        ];
        
        allowedFields.forEach(field => {
          if (req.body[field] !== undefined) {
            updateFields[field] = req.body[field];
          }
        });

        const result = await lessonsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ success: false, message: "Lesson not found" });
        }

        res.status(200).send({ 
          success: true, 
          message: "Lesson updated successfully", 
          result 
        });

      } catch (error) {
        console.error("Error updating lesson:", error);
        res.status(500).send({ 
          success: false, 
          message: "Failed to update lesson",
          error: error.message 
        });
      }
    });

    // --- DELETE LESSON BY ID ---
    app.delete('/api/lessons/:id',verifyToken, async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ success: false, message: "Invalid lesson ID format" });
        }

        const result = await lessonsCollection.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
          return res.status(404).send({ success: false, message: "Lesson not found" });
        }

        res.status(200).send({
          success: true,
          message: "Lesson deleted successfully"
        });

      } catch (error) {
        console.error("Error deleting lesson:", error);
        res.status(500).send({
          success: false,
          message: "Failed to delete lesson",
          error: error.message
        });
      }
    });

    // --- GET ALL LESSONS FOR ADMIN (With Creator Data) ---
    app.get('/api/lessons/admin-all', async (req, res) => {
      try {
        const lessons = await lessonsCollection
          .find({})
          .sort({ createdAt: -1 })
          .toArray();

        const creatorIds = [...new Set(lessons.map(lesson => lesson.creatorId).filter(Boolean))];
        const usersCollection = db.collection("user"); 
        
        const objectIdCreatorIds = creatorIds
          .filter(id => ObjectId.isValid(id))
          .map(id => new ObjectId(id));

        const users = await usersCollection.find({
          $or: [
            { _id: { $in: creatorIds } },
            { _id: { $in: objectIdCreatorIds } }
          ]
        }).toArray();

        const userMap = {};
        users.forEach(user => {
          userMap[user._id.toString()] = {
            name: user.name || "Anonymous",
            image: user.image || ""
          };
        });

        const enrichedLessons = lessons.map(lesson => {
          const creator = userMap[lesson.creatorId] || { name: "Anonymous", image: "" };
          return {
            ...lesson,
            creatorName: creator.name,
            creatorAvatar: creator.image
          };
        });

        res.status(200).send(enrichedLessons);

      } catch (error) {
        console.error("Error fetching admin lessons:", error);
        res.status(500).send({ 
          success: false, 
          message: "Failed to fetch admin lessons",
          error: error.message 
        });
      }
    });

    // --- GET ALL PUBLIC LESSONS ---
// --- GET /api/lessons (Query, Filter, Search & Pagination Supported) ---
app.get('/api/lessons', async (req, res) => {
  try {
    const {
      search = "",
      category = "All",
      emotionalTone = "All",
      accessLevel = "All",
      visibility = "Public",
      sortBy = "newest", // newest | oldest | popular
      page = 1,
      limit = 0 // Set limit > 0 for pagination (e.g. limit=8)
    } = req.query;

    const lessonsCollection = db.collection("lessons");
    const usersCollection = db.collection("user");

    // 1. Base Query Builder
    const query = {};

    // Filter by Visibility
    if (visibility !== "all") {
      query.visibility = { $regex: new RegExp(`^${visibility}$`, "i") };
    }

    // Filter by Category
    if (category && category !== "All") {
      query.category = category;
    }

    // Filter by Emotional Tone
    if (emotionalTone && emotionalTone !== "All") {
      query.emotionalTone = emotionalTone;
    }

    // Filter by Access Level (Free / Premium)
    if (accessLevel && accessLevel !== "All") {
      query.accessLevel = accessLevel;
    }

    // 2. Search Filter (Title, Description, or Author Name)
    if (search.trim()) {
      const searchRegex = new RegExp(search.trim(), "i");

      // Find any authors matching search query to include their lessons
      const matchingUsers = await usersCollection
        .find({ name: searchRegex })
        .project({ _id: 1 })
        .toArray();

      const matchingUserIds = matchingUsers.map((u) => u._id.toString());
      const matchingUserObjectIds = matchingUsers.map((u) => u._id);

      query.$or = [
        { title: searchRegex },
        { description: searchRegex },
        { creatorName: searchRegex },
        { creatorId: { $in: [...matchingUserIds, ...matchingUserObjectIds] } }
      ];
    }

    // 3. Sorting Options
    let sortOptions = { createdAt: -1 }; // Default: newest
    if (sortBy === "oldest") {
      sortOptions = { createdAt: 1 };
    } else if (sortBy === "popular") {
      sortOptions = { views: -1, likesCount: -1 };
    }

    // 4. Pagination Setup
    const pageNumber = Math.max(1, parseInt(page, 10) || 1);
    const limitNumber = parseInt(limit, 10) || 0;
    const skip = limitNumber > 0 ? (pageNumber - 1) * limitNumber : 0;

    // 5. Query MongoDB
    const totalLessons = await lessonsCollection.countDocuments(query);
    
    let lessonsCursor = lessonsCollection
      .find(query)
      .sort(sortOptions)
      .skip(skip);

    if (limitNumber > 0) {
      lessonsCursor = lessonsCursor.limit(limitNumber);
    }

    const lessons = await lessonsCursor.toArray();

    // 6. Enrich Lessons with User Information (Creator Name & Avatar)
    const creatorIds = [
      ...new Set(lessons.map((lesson) => lesson.creatorId || lesson.userId).filter(Boolean))
    ];

    const objectIdCreatorIds = creatorIds
      .filter((id) => ObjectId.isValid(id))
      .map((id) => new ObjectId(id));

    const users = await usersCollection
      .find({
        $or: [
          { _id: { $in: creatorIds } },
          { _id: { $in: objectIdCreatorIds } }
        ]
      })
      .toArray();

    const userMap = {};
    users.forEach((user) => {
      userMap[user._id.toString()] = {
        name: user.name || "Anonymous Creator",
        image: user.image || ""
      };
    });

    const enrichedLessons = lessons.map((lesson) => {
      const creatorIdStr = (lesson.creatorId || lesson.userId)?.toString();
      const creator = userMap[creatorIdStr] || {
        name: lesson.creatorName || "Anonymous Creator",
        image: lesson.creatorAvatar || ""
      };

      return {
        ...lesson,
        creatorName: creator.name,
        creatorAvatar: creator.image
      };
    });

    // 7. Response Format
    // Returns full pagination info if limit > 0, otherwise returns the array directly
    if (limitNumber > 0) {
      return res.status(200).json({
        success: true,
        total: totalLessons,
        page: pageNumber,
        totalPages: Math.ceil(totalLessons / limitNumber),
        data: enrichedLessons
      });
    }

    res.status(200).send(enrichedLessons);

  } catch (error) {
    console.error("Error fetching lessons:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch query-based lessons",
      error: error.message
    });
  }
});
//no need tokenization for this

    // --- GET FEATURED LESSONS ---
    // --- GET FEATURED LESSONS (Only Public, Featured, and Reviewed) ---
    app.get('/api/lessons/featured', async (req, res) => {
      try {
        const lessons = await lessonsCollection
          .find({ 
            visibility: "Public", 
            isFeatured: true,
            isReviewed: true 
          })
          .sort({ createdAt: -1 })
          .limit(8)
          .toArray();

        const creatorIds = [...new Set(lessons.map(lesson => lesson.creatorId).filter(Boolean))];
        const usersCollection = db.collection("user"); 
        
        const objectIdCreatorIds = creatorIds
          .filter(id => ObjectId.isValid(id))
          .map(id => new ObjectId(id));

        const users = await usersCollection.find({
          $or: [
            { _id: { $in: creatorIds } },
            { _id: { $in: objectIdCreatorIds } }
          ]
        }).toArray();

        const userMap = {};
        users.forEach(user => {
          userMap[user._id.toString()] = {
            name: user.name || user.email || "Anonymous",
            image: user.image || ""
          };
        });

        const enrichedLessons = lessons.map(lesson => {
          const creator = userMap[lesson.creatorId] || { name: "Anonymous", image: "" };
          return {
            ...lesson,
            creatorName: creator.name,
            creatorAvatar: creator.image
          };
        });

        res.status(200).send(enrichedLessons);
      } catch (error) {
        console.error("Error fetching featured lessons:", error);
        res.status(500).send({ 
          success: false, 
          message: "Failed to fetch featured lessons", 
          error: error.message 
        });
      }
    });
    //no need tokenization for this

    
// --- GET AUTHOR PROFILE & THEIR PUBLIC LESSONS ---
    app.get('/api/author-profile/:id', async (req, res) => {
      try {
        const { id } = req.params;

        if (!id || id === 'undefined') {
          return res.status(400).send({ success: false, message: "Valid Author ID is required" });
        }

        const usersCollection = db.collection("user");

        // 1. Fetch Author info from user collection
        const userQuery = {
          $or: [
            { _id: id },
            ...(ObjectId.isValid(id) ? [{ _id: new ObjectId(id) }] : [])
          ]
        };

        const userDoc = await usersCollection.findOne(userQuery);

        const author = {
          id: id,
          name: userDoc?.name || userDoc?.email || "Anonymous Creator",
          image: userDoc?.image || "",
          role: userDoc?.role || "user"
        };

        // 2. Fetch all public lessons created by this author
        const lessonsQuery = {
          $or: [
            { creatorId: id },
            { userId: id },
            { authorId: id },
            ...(ObjectId.isValid(id) ? [
              { creatorId: new ObjectId(id) },
              { userId: new ObjectId(id) },
              { authorId: new ObjectId(id) }
            ] : [])
          ],
          visibility: "Public"
        };

        const lessons = await lessonsCollection
          .find(lessonsQuery)
          .sort({ createdAt: -1 })
          .toArray();

        const enrichedLessons = lessons.map(lesson => ({
          ...lesson,
          creatorName: author.name,
          creatorAvatar: author.image
        }));

        res.status(200).send({
          success: true,
          author,
          lessons: enrichedLessons
        });
      } catch (error) {
        console.error("Error fetching author profile:", error);
        res.status(500).send({ 
          success: false, 
          message: "Failed to fetch author profile", 
          error: error.message 
        });
      }
    });

    // --- GET TOP CONTRIBUTORS OF THE WEEK ---
    app.get('/api/top-contributors', async (req, res) => {
      try {
        const usersCollection = db.collection("user");

        // 1. Calculate 7-day cutoff date
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        // 2. Aggregate recent lesson creators
        let topCreators = await lessonsCollection.aggregate([
          { 
            $match: { 
              creatorId: { $ne: null },
              createdAt: { $gte: sevenDaysAgo }
            } 
          },
          { 
            $group: { 
              _id: "$creatorId", 
              recentLessons: { $sum: 1 },
              totalLikes: { $sum: { $ifNull: ["$likesCount", 0] } }
            } 
          },
          { $sort: { recentLessons: -1, totalLikes: -1 } },
          { $limit: 4 }
        ]).toArray();

        // Fallback: If fewer than 4 published this week, fetch all-time top contributors
        if (topCreators.length < 4) {
          topCreators = await lessonsCollection.aggregate([
            { $match: { creatorId: { $ne: null } } },
            { 
              $group: { 
                _id: "$creatorId", 
                recentLessons: { $sum: 1 },
                totalLikes: { $sum: { $ifNull: ["$likesCount", 0] } }
              } 
            },
            { $sort: { recentLessons: -1, totalLikes: -1 } },
            { $limit: 4 }
          ]).toArray();
        }

        // 3. Fetch user profile details for each creator
        const creatorIds = topCreators.map(c => c._id);
        const objectIdCreatorIds = creatorIds.filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id));

        const matchedUsers = await usersCollection.find({
          $or: [
            { _id: { $in: creatorIds } },
            { _id: { $in: objectIdCreatorIds } }
          ]
        }).toArray();

        const userMap = {};
        matchedUsers.forEach(u => {
          userMap[u._id.toString()] = {
            name: u.name || "Anonymous Creator",
            image: u.image || "",
            role: u.role || "Creator",
            headline: u.headline || (u.role === 'admin' ? "Platform Educator" : "Wisdom Contributor")
          };
        });

        const result = topCreators.map(creator => {
          const user = userMap[creator._id?.toString()] || {
            name: "Community Creator",
            image: "",
            role: "Creator",
            headline: "Wisdom Contributor"
          };

          return {
            userId: creator._id,
            name: user.name,
            image: user.image,
            headline: user.headline,
            lessonsCount: creator.recentLessons,
            totalLikes: creator.totalLikes
          };
        });

        res.status(200).send(result);
      } catch (error) {
        console.error("Error fetching top contributors:", error);
        res.status(500).send({ success: false, message: "Failed to load top contributors", error: error.message });
      }
    });

    // --- GET MOST SAVED LESSONS (With Enriched Author Data) ---
    app.get('/api/lessons/most-saved', async (req, res) => {
      try {
        const usersCollection = db.collection("user");

        // 1. Fetch top saved public lessons
        const mostSaved = await lessonsCollection.aggregate([
          { 
            $match: { 
              visibility: "Public", 
              isReviewed: true 
            } 
          },
          {
            $addFields: {
              savesCount: {
                $cond: {
                  if: { $isArray: "$savedBy" },
                  then: { $size: "$savedBy" },
                  else: 0
                }
              }
            }
          },
          { $sort: { savesCount: -1, likesCount: -1, createdAt: -1 } },
          { $limit: 4 }
        ]).toArray();

        // 2. Extract author/creator IDs
        const creatorIds = mostSaved
          .map(l => l.creatorId || l.userId || l.authorId)
          .filter(Boolean);

        const objectIdCreatorIds = creatorIds
          .filter(id => ObjectId.isValid(id))
          .map(id => new ObjectId(id));

        // 3. Look up user details in the user collection
        const users = await usersCollection.find({
          $or: [
            { _id: { $in: creatorIds } },
            { _id: { $in: objectIdCreatorIds } }
          ]
        }).toArray();

        const userMap = {};
        users.forEach(u => {
          userMap[u._id.toString()] = {
            name: u.name || u.email || "Community Creator",
            image: u.image || ""
          };
        });

        // 4. Attach creator name and avatar to each lesson
        const enrichedLessons = mostSaved.map(lesson => {
          const cId = (lesson.creatorId || lesson.userId || lesson.authorId)?.toString();
          const author = userMap[cId];

          return {
            ...lesson,
            creatorName: lesson.creatorName || author?.name || "Community Creator",
            creatorAvatar: lesson.creatorAvatar || author?.image || ""
          };
        });

        res.status(200).send(enrichedLessons);
      } catch (error) {
        console.error("Error fetching most saved lessons:", error);
        res.status(500).send({ 
          success: false, 
          message: "Failed to fetch most saved lessons", 
          error: error.message 
        });
      }
    });
    // --- GET SINGLE LESSON BY ID ---
    // --- GET SINGLE LESSON BY ID (With Normalized Creator Data) ---
    app.get('/api/lessons/:id',verifyToken, async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ success: false, message: "Invalid Lesson ID" });
        }

        const lesson = await lessonsCollection.findOne({ _id: new ObjectId(id) });
        if (!lesson) {
          return res.status(404).send({ success: false, message: "Lesson not found" });
        }

        // Resolve creator ID across all legacy field conventions
        const creatorId = lesson.creatorId || lesson.userId || lesson.authorId || null;
        let creatorName = lesson.creatorName || "Anonymous";
        let creatorAvatar = lesson.coverImage ? "" : "";

        if (creatorId) {
          const usersCollection = db.collection("user");
          const userQuery = {
            $or: [
              { _id: creatorId },
              ...(ObjectId.isValid(creatorId) ? [{ _id: new ObjectId(creatorId) }] : [])
            ]
          };

          const userDoc = await usersCollection.findOne(userQuery);
          if (userDoc) {
            creatorName = userDoc.name || userDoc.email || creatorName;
            creatorAvatar = userDoc.image || creatorAvatar;
          }
        }

        res.status(200).send({
          ...lesson,
          creatorId: creatorId ? creatorId.toString() : null,
          creatorName,
          creatorAvatar: creatorAvatar || lesson.creatorAvatar || ""
        });

      } catch (error) {
        console.error("Error fetching lesson:", error);
        res.status(500).send({ success: false, message: "Server error", error: error.message });
      }
    });

    // --- TOGGLE LIKE / LOVE REACT ---
    app.post('/api/lessons/:id/like',verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { userId } = req.body;

        if (!ObjectId.isValid(id) || !userId) {
          return res.status(400).send({ success: false, message: "Invalid ID or User missing" });
        }

        const lesson = await lessonsCollection.findOne({ _id: new ObjectId(id) });
        if (!lesson) {
          return res.status(404).send({ success: false, message: "Lesson not found" });
        }

        const likes = lesson.likes || [];
        const isAlreadyLiked = likes.includes(userId);

        let updateQuery;
        if (isAlreadyLiked) {
          updateQuery = { 
            $pull: { likes: userId }, 
            $inc: { likesCount: -1 } 
          };
        } else {
          updateQuery = { 
            $addToSet: { likes: userId }, 
            $inc: { likesCount: 1 } 
          };
        }

        const updatedLesson = await lessonsCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          updateQuery,
          { returnDocument: 'after' }
        );

        res.status(200).send({
          success: true,
          isLiked: !isAlreadyLiked,
          likesCount: updatedLesson.likesCount
        });

      } catch (error) {
        console.error("Error toggling like:", error);
        res.status(500).send({ success: false, message: "Server error while updating like" });
      }
    });

    // --- TOGGLE BOOKMARK ---
   // --- TOGGLE BOOKMARK ---
    app.post('/api/lessons/:id/bookmark',verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { userId } = req.body;

        if (!ObjectId.isValid(id) || !userId) {
          return res.status(400).send({ success: false, message: "Invalid ID or User missing" });
        }

        const lesson = await lessonsCollection.findOne({ _id: new ObjectId(id) });
        if (!lesson) {
          return res.status(404).send({ success: false, message: "Lesson not found" });
        }

        const savedBy = lesson.savedBy || [];
        const isAlreadyBookmarked = savedBy.includes(userId);

        let updateQuery;
        if (isAlreadyBookmarked) {
          updateQuery = { $pull: { savedBy: userId } };
        } else {
          updateQuery = { $addToSet: { savedBy: userId } };
        }

        await lessonsCollection.updateOne({ _id: new ObjectId(id) }, updateQuery);

        res.status(200).send({
          success: true,
          isBookmarked: !isAlreadyBookmarked,
          message: isAlreadyBookmarked ? "Bookmark removed" : "Lesson bookmarked successfully!"
        });

      } catch (error) {
        console.error("Error toggling bookmark:", error);
        res.status(500).send({ success: false, message: "Server error while bookmarking" });
      }
    });

    // --- REPORT LESSON ---
    // --- POST SUBMIT LESSON REPORT ---
    app.post('/api/lessons/:id/report',verifyToken, express.json(), async (req, res) => {
  try {
    const { id } = req.params;
    const { reporterUserId, reportedUserEmail, reason, details } = req.body;

    const reportsCollection = db.collection("reports");
    const lessonsCollection = db.collection("lessons");

    const collections = await db.listCollections().toArray();
    const colNames = collections.map(c => c.name);
    const userCollectionName = colNames.includes("user") ? "user" : (colNames.includes("users") ? "users" : "user");
    const usersCollection = db.collection(userCollectionName);

    // Look up target lesson by string or ObjectId
    let queryConditions = [{ _id: id }];
    if (ObjectId.isValid(id)) {
      try { queryConditions.push({ _id: new ObjectId(id) }); } catch (e) {}
    }
    const targetLesson = await lessonsCollection.findOne({ $or: queryConditions });

    // Look up author name if not directly on the lesson
    let creatorName = targetLesson?.creatorName || targetLesson?.authorName;
    const creatorId = targetLesson?.creatorId || targetLesson?.userId || targetLesson?.authorId;

    if (!creatorName && creatorId) {
      let userQuery = [{ _id: creatorId.toString() }];
      if (ObjectId.isValid(creatorId)) {
        try { userQuery.push({ _id: new ObjectId(creatorId) }); } catch (e) {}
      }
      const authorUser = await usersCollection.findOne({ $or: userQuery });
      creatorName = authorUser?.name || authorUser?.email;
    }

    const newReport = {
      lessonId: id,
      lessonTitle: targetLesson?.title || "Untitled Lesson",
      creatorId: creatorId ? creatorId.toString() : null,
      creatorName: creatorName || "Community Creator",
      authorName: creatorName || "Community Creator",
      reporterUserId: reporterUserId,
      reporterEmail: reportedUserEmail || "Anonymous",
      reason: reason,
      details: details || "",
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await reportsCollection.insertOne(newReport);
    res.status(201).json({ success: true, message: "Report submitted successfully.", reportId: result.insertedId });
  } catch (error) {
    console.error("Error submitting report:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

    // --- GET ALL REPORTS (Robust User & Lesson Matching) ---
 // --- 1. GET ALL REPORTS (ADMIN) ---
    // --- GET ALL ADMIN REPORTS (Auto-Populates Author & Lesson Details) ---
app.get('/api/admin/reports', async (req, res) => {
  try {
    const reportsCollection = db.collection("reports");
    const lessonsCollection = db.collection("lessons");

    // Auto-detect collection naming ('user' vs 'users')
    const collections = await db.listCollections().toArray();
    const colNames = collections.map(c => c.name);
    const userCollectionName = colNames.includes("user") 
      ? "user" 
      : (colNames.includes("users") ? "users" : "user");
    const usersCollection = db.collection(userCollectionName);

    const reports = await reportsCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    if (!reports || reports.length === 0) {
      return res.status(200).json([]);
    }

    // 1. Fetch matching lessons
    const rawLessonIds = reports.map(r => r.lessonId).filter(Boolean);
    const lessonQueryIds = [];
    rawLessonIds.forEach(id => {
      lessonQueryIds.push(id.toString());
      if (ObjectId.isValid(id)) {
        try { lessonQueryIds.push(new ObjectId(id)); } catch (e) {}
      }
    });

    const lessons = await lessonsCollection.find({
      _id: { $in: lessonQueryIds }
    }).toArray();

    const lessonMap = {};
    const rawUserIds = [];

    lessons.forEach(l => {
      lessonMap[l._id.toString()] = l;
      const uId = l.creatorId || l.userId || l.authorId;
      if (uId) rawUserIds.push(uId);
    });

    reports.forEach(r => {
      if (r.creatorId) rawUserIds.push(r.creatorId);
      if (r.reporterUserId) rawUserIds.push(r.reporterUserId);
    });

    // 2. Fetch author profiles from user collection
    const userQueryIds = [];
    rawUserIds.forEach(id => {
      userQueryIds.push(id.toString());
      if (ObjectId.isValid(id)) {
        try { userQueryIds.push(new ObjectId(id)); } catch (e) {}
      }
    });

    const userMap = {};
    if (userQueryIds.length > 0) {
      const users = await usersCollection.find({
        _id: { $in: userQueryIds }
      }).toArray();

      users.forEach(u => {
        userMap[u._id.toString()] = u;
      });
    }

    // 3. Enrich every report payload
    const enrichedReports = reports.map(report => {
      const matchedLesson = lessonMap[report.lessonId?.toString()];
      const creatorId = (
        matchedLesson?.creatorId || 
        matchedLesson?.userId || 
        matchedLesson?.authorId || 
        report.creatorId
      )?.toString();

      const authorUser = creatorId ? userMap[creatorId] : null;
      const reporterUser = report.reporterUserId ? userMap[report.reporterUserId?.toString()] : null;

      const authorName = 
        matchedLesson?.creatorName ||
        matchedLesson?.authorName ||
        authorUser?.name ||
        authorUser?.displayName ||
        report.authorName ||
        report.creatorName ||
        "Community Creator";

      const lessonTitle = 
        matchedLesson?.title || 
        report.lessonTitle || 
        "Untitled Lesson";

      const reporterName = 
        reporterUser?.name ||
        report.reporterName ||
        report.userName ||
        report.reporterEmail ||
        "Anonymous User";

      return {
        ...report,
        lessonTitle,
        authorName,
        creatorName: authorName,
        reporterName,
        reporterEmail: report.reporterEmail || reporterUser?.email || "Anonymous",
      };
    });

    res.status(200).json(enrichedReports);
  } catch (error) {
    console.error("Error fetching admin reports:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to load reports", 
      error: error.message 
    });
  }
});

    // --- 2. BATCH RESOLVE REPORTS BY LESSON ID (ADMIN) ---
    app.patch('/api/admin/reports/lesson/:lessonId/resolve', async (req, res) => {
      try {
        const { lessonId } = req.params;
        const reportsCollection = db.collection("reports");

        const filter = {
          $or: [
            { lessonId: lessonId },
            ...(ObjectId.isValid(lessonId) ? [{ lessonId: new ObjectId(lessonId) }] : [])
          ]
        };

        const result = await reportsCollection.updateMany(filter, {
          $set: {
            status: "resolved",
            resolvedAt: new Date(),
            updatedAt: new Date()
          }
        });

        res.status(200).json({ 
          success: true, 
          message: "All reports for this lesson marked as resolved.",
          modifiedCount: result.modifiedCount 
        });
      } catch (error) {
        console.error("Error resolving lesson reports:", error);
        res.status(500).json({ 
          success: false, 
          message: "Failed to resolve reports", 
          error: error.message 
        });
      }
    });


app.patch('/api/users/upgrade-plan', async (req, res) => {
      try {
        const usersCollection = db.collection("user");
        const { email, userId } = req.body || {};

        if (!email && !userId) {
          return res.status(400).json({
            success: false,
            message: 'User email or userId is required.',
          });
        }

        // Build search filter matching by email or _id
        let filter = {};
        if (email) {
          filter = { email: email.toLowerCase().trim() };
        } else if (userId) {
          filter = {
            $or: [
              { _id: userId },
              ...(ObjectId.isValid(userId) ? [{ _id: new ObjectId(userId) }] : [])
            ]
          };
        }

        const result = await usersCollection.updateOne(filter, {
          $set: {
            plan: 'premium',
            updatedAt: new Date(),
          },
        });

        if (result.matchedCount === 0) {
          console.warn(`[Upgrade] User not found for query:`, filter);
          return res.status(404).json({
            success: false,
            message: 'User not found in database.',
          });
        }

        console.log(`[Upgrade Success] Upgraded user:`, filter);
        return res.status(200).json({
          success: true,
          message: 'User upgraded to Premium successfully.',
        });
      } catch (error) {
        console.error('[Upgrade Error]:', error);
        return res.status(500).json({
          success: false,
          message: error.message || 'Internal server error.',
        });
      }
    });
    // --- 3. DELETE LESSON AND AUTO-RESOLVE REPORTS (ADMIN) ---
    app.delete('/api/lessons/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const lessonsCollection = db.collection("lessons");
        const reportsCollection = db.collection("reports");

        const lessonQuery = {
          $or: [
            { _id: id },
            ...(ObjectId.isValid(id) ? [{ _id: new ObjectId(id) }] : [])
          ]
        };

        const deleteResult = await lessonsCollection.deleteOne(lessonQuery);

        // Auto-resolve any remaining report tickets for this deleted lesson
        await reportsCollection.updateMany(
          {
            $or: [
              { lessonId: id },
              ...(ObjectId.isValid(id) ? [{ lessonId: new ObjectId(id) }] : [])
            ]
          },
          {
            $set: {
              status: "resolved",
              actionTaken: "lesson_deleted",
              resolvedAt: new Date(),
              updatedAt: new Date()
            }
          }
        );

        res.status(200).json({ 
          success: true, 
          message: "Lesson permanently deleted and reports resolved.",
          deletedCount: deleteResult.deletedCount
        });
      } catch (error) {
        console.error("Error deleting lesson:", error);
        res.status(500).json({ 
          success: false, 
          message: "Failed to delete lesson", 
          error: error.message 
        });
      }
    });

    // --- RESOLVE / UPDATE REPORT STATUS ---
   // --- CLEAR / RESOLVE ALL REPORTS FOR A LESSON (IGNORE ACTION) ---
// --- GET ALL ADMIN REPORTS (Auto-Enriched with Author & Lesson Details) ---
// --- GET ALL ADMIN REPORTS (Robust Author & Lesson Resolver) ---
app.get('/api/admin/reports', async (req, res) => {
  try {
    const reportsCollection = db.collection("reports");
    const lessonsCollection = db.collection("lessons");

    // 1. Detect if the collection is named 'user' or 'users'
    const collections = await db.listCollections().toArray();
    const colNames = collections.map(c => c.name);
    const userCollectionName = colNames.includes("user") 
      ? "user" 
      : (colNames.includes("users") ? "users" : "user");
    const usersCollection = db.collection(userCollectionName);

    const reports = await reportsCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    if (!reports || reports.length === 0) {
      return res.status(200).json([]);
    }

    // 2. Build Query IDs for Lessons (supporting both String and ObjectId)
    const rawLessonIds = reports.map(r => r.lessonId).filter(Boolean);
    const lessonQueryIds = [];

    rawLessonIds.forEach(id => {
      lessonQueryIds.push(id.toString());
      if (ObjectId.isValid(id)) {
        try { lessonQueryIds.push(new ObjectId(id)); } catch (e) {}
      }
    });

    const lessons = await lessonsCollection.find({
      _id: { $in: lessonQueryIds }
    }).toArray();

    // Map lessons by stringified ID
    const lessonMap = {};
    const rawUserIds = [];

    lessons.forEach(l => {
      lessonMap[l._id.toString()] = l;
      const uid = l.creatorId || l.userId || l.authorId;
      if (uid) rawUserIds.push(uid);
    });

    reports.forEach(r => {
      const uid = r.creatorId || r.authorId;
      if (uid) rawUserIds.push(uid);
    });

    // 3. Build Query IDs for Users (supporting both String and ObjectId)
    const userQueryIds = [];
    rawUserIds.forEach(id => {
      userQueryIds.push(id.toString());
      if (ObjectId.isValid(id)) {
        try { userQueryIds.push(new ObjectId(id)); } catch (e) {}
      }
    });

    const userMap = {};
    if (userQueryIds.length > 0) {
      const users = await usersCollection.find({
        _id: { $in: userQueryIds }
      }).toArray();

      users.forEach(u => {
        userMap[u._id.toString()] = u.name || u.displayName || u.email || "Community Author";
      });
    }

    // 4. Enrich every report with guaranteed author details
    const enrichedReports = reports.map(report => {
      const lId = report.lessonId?.toString();
      const lesson = lessonMap[lId];

      const creatorId = (
        lesson?.creatorId || 
        lesson?.userId || 
        lesson?.authorId || 
        report.creatorId
      )?.toString();

      const resolvedAuthorName =
        lesson?.creatorName ||
        lesson?.authorName ||
        (creatorId ? userMap[creatorId] : null) ||
        report.creatorName ||
        report.authorName ||
        "Community Creator";

      const resolvedLessonTitle =
        lesson?.title ||
        report.lessonTitle ||
        "Untitled Lesson";

      return {
        ...report,
        lessonTitle: resolvedLessonTitle,
        creatorName: resolvedAuthorName,
        authorName: resolvedAuthorName,
        authorEmail: creatorId && userMap[creatorId] ? userMap[creatorId] : null
      };
    });

    res.status(200).json(enrichedReports);
  } catch (error) {
    console.error("Error fetching admin reports:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to load reports", 
      error: error.message 
    });
  }
});

    // --- GET COMMENTS FOR A LESSON ---
    app.get('/api/comments/:lessonId',verifyToken, async (req, res) => {
      try {
        const { lessonId } = req.params;

        if (!ObjectId.isValid(lessonId)) {
          return res.status(400).send({ success: false, message: "Invalid Lesson ID" });
        }

        const comments = await db.collection("comments").aggregate([
          { $match: { lessonId: lessonId } },
          { $sort: { createdAt: -1 } },
          {
            $lookup: {
              from: "user",
              localField: "userId",
              foreignField: "_id",
              as: "creatorInfo"
            }
          },
          {
            $unwind: {
              path: "$creatorInfo",
              preserveNullAndEmptyArrays: true
            }
          },
          {
            $project: {
              text: 1,
              createdAt: 1,
              creatorName: "$creatorInfo.name",
              creatorAvatar: "$creatorInfo.image"
            }
          }
        ]).toArray();

        res.status(200).send(comments);

      } catch (error) {
        console.error("Error fetching comments:", error);
        res.status(500).send({ success: false, message: "Failed to fetch comments" });
      }
    });

    // --- POST A NEW COMMENT ---
    app.post('/api/comments',verifyToken, async (req, res) => {
      try {
        const { lessonId, userId, text } = req.body;

        if (!lessonId || !userId || !text) {
          return res.status(400).send({ success: false, message: "Missing required fields" });
        }

        let finalUserId = userId;
        if (ObjectId.isValid(userId) && String(new ObjectId(userId)) === userId) {
          finalUserId = new ObjectId(userId);
        }

        const newComment = {
          lessonId: lessonId,
          userId: finalUserId, 
          text: text,
          createdAt: new Date()
        };

        const result = await db.collection("comments").insertOne(newComment);

        if (result.acknowledged) {
          res.status(201).send({
            _id: result.insertedId,
            ...newComment
          });
        } else {
          res.status(500).send({ success: false, message: "Failed to insert comment" });
        }

      } catch (error) {
        console.error("Error posting comment:", error);
        res.status(500).send({ success: false, message: "Failed to post comment", error: error.message });
      }
    });



    // --- GET SAVED LESSONS FOR A USER ---
    app.get('/api/saved-lessons/:userId', async (req, res) => {
      try {
        const { userId } = req.params;

        if (!userId) {
          return res.status(400).send({ success: false, message: "User ID is required" });
        }

        const query = {
          $or: [
            { savedBy: userId },
            ...(ObjectId.isValid(userId) ? [{ savedBy: new ObjectId(userId) }] : [])
          ]
        };

        const savedLessons = await lessonsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.status(200).send(savedLessons);
      } catch (error) {
        console.error("Error fetching saved lessons:", error);
        res.status(500).send({ 
          success: false, 
          message: "Failed to fetch saved lessons", 
          error: error.message 
        });
      }
    });

    // --- GET SAVED LESSONS FOR A USER (With Author Info) ---
    app.get('/api/saved-lessons/:userId', async (req, res) => {
      try {
        const { userId } = req.params;

        if (!userId) {
          return res.status(400).send({ success: false, message: "User ID is required" });
        }

        const query = {
          $or: [
            { savedBy: userId },
            ...(ObjectId.isValid(userId) ? [{ savedBy: new ObjectId(userId) }] : [])
          ]
        };

        const lessons = await lessonsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        // Populate Creator / Author information
        const creatorIds = [...new Set(lessons.map(lesson => lesson.creatorId).filter(Boolean))];
        const usersCollection = db.collection("user");
        
        const objectIdCreatorIds = creatorIds
          .filter(id => ObjectId.isValid(id))
          .map(id => new ObjectId(id));

        const users = await usersCollection.find({
          $or: [
            { _id: { $in: creatorIds } },
            { _id: { $in: objectIdCreatorIds } }
          ]
        }).toArray();

        const userMap = {};
        users.forEach(user => {
          userMap[user._id.toString()] = {
            name: user.name || user.email || "Anonymous",
            image: user.image || ""
          };
        });

        const enrichedLessons = lessons.map(lesson => {
          const creator = userMap[String(lesson.creatorId)] || { name: "Anonymous", image: "" };
          return {
            ...lesson,
            creatorName: creator.name,
            creatorAvatar: creator.image
          };
        });

        res.status(200).send(enrichedLessons);
      } catch (error) {
        console.error("Error fetching saved lessons:", error);
        res.status(500).send({ 
          success: false, 
          message: "Failed to fetch saved lessons", 
          error: error.message 
        });
      }
    });
    // --- GET ADMIN PLATFORM STATS ---
    // --- GET COMPREHENSIVE ADMIN PLATFORM ANALYTICS ---
    // --- GET ADMIN DASHBOARD STATS ---
// --- GET COMPREHENSIVE ADMIN OVERVIEW STATS ---
    app.get('/api/admin/stats', async (req, res) => {
      try {
        const usersCollection = db.collection("user");
        const lessonsCollection = db.collection("lessons");
        const reportsCollection = db.collection("reports");

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        sevenDaysAgo.setHours(0, 0, 0, 0);

        // 1. Fetch Primary Counts in Parallel
        const [
          totalUsers,
          totalLessons,
          totalPublicLessons,
          openReports,
          todayLessons
        ] = await Promise.all([
          usersCollection.countDocuments(),
          lessonsCollection.countDocuments(),
          lessonsCollection.countDocuments({
            $or: [
              { visibility: "Public" },
              { visibility: { $regex: /^public$/i } },
              { visibility: { $exists: false } } // Fallback for legacy documents
            ]
          }),
          reportsCollection.find({
            status: { $not: { $regex: /^resolved$/i } }
          }).toArray(),
          lessonsCollection.countDocuments({
            createdAt: { $gte: startOfToday }
          })
        ]);

        // Calculate unique flagged lessons needing moderation
        const uniqueReportedLessons = new Set(
          openReports.map(r => r.lessonId?.toString()).filter(Boolean)
        );
        const reportedLessonsCount = uniqueReportedLessons.size || openReports.length;

        // 2. Generate 7-Day Day Label Timeline
        const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const last7Days = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          last7Days.push({
            dateStr: d.toISOString().split("T")[0],
            dayName: daysOfWeek[d.getDay()],
            count: 0
          });
        }

        // 3. Lesson Growth Trend (Past 7 Days)
        const recentLessons = await lessonsCollection.find({
          createdAt: { $gte: sevenDaysAgo }
        }).toArray();

        const lessonGrowthMap = {};
        last7Days.forEach(d => { lessonGrowthMap[d.dateStr] = 0; });
        recentLessons.forEach(lesson => {
          if (lesson.createdAt) {
            const dateStr = new Date(lesson.createdAt).toISOString().split("T")[0];
            if (lessonGrowthMap[dateStr] !== undefined) {
              lessonGrowthMap[dateStr]++;
            }
          }
        });
        const lessonGrowth = last7Days.map(d => ({
          day: d.dayName,
          count: lessonGrowthMap[d.dateStr] || 0
        }));

        // 4. User Registration Trend (Past 7 Days)
        const recentUsers = await usersCollection.find({
          createdAt: { $gte: sevenDaysAgo }
        }).toArray();

        const userGrowthMap = {};
        last7Days.forEach(d => { userGrowthMap[d.dateStr] = 0; });
        recentUsers.forEach(u => {
          if (u.createdAt) {
            const dateStr = new Date(u.createdAt).toISOString().split("T")[0];
            if (userGrowthMap[dateStr] !== undefined) {
              userGrowthMap[dateStr]++;
            }
          }
        });
        const userGrowth = last7Days.map(d => ({
          day: d.dayName,
          count: userGrowthMap[d.dateStr] || 0
        }));

        // 5. Top Active Contributors
        const topAgg = await lessonsCollection.aggregate([
          { $match: { creatorId: { $ne: null } } },
          { $group: { _id: "$creatorId", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 5 }
        ]).toArray();

        const creatorIds = topAgg.map(t => t._id);
        const objectIdCreatorIds = creatorIds.filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id));

        const matchedUsers = await usersCollection.find({
          $or: [
            { _id: { $in: creatorIds } },
            { _id: { $in: objectIdCreatorIds } }
          ]
        }).toArray();

        const userLookup = {};
        matchedUsers.forEach(u => {
          userLookup[u._id.toString()] = u;
        });

        const activeContributors = topAgg.map(item => {
          const u = userLookup[item._id?.toString()];
          return {
            userId: item._id,
            name: u?.name || "Community Creator",
            email: u?.email || "",
            image: u?.image || "",
            role: u?.role || "user",
            lessonsCount: item.count
          };
        });

        res.status(200).json({
          success: true,
          totalUsers,
          totalLessons,
          totalPublicLessons: totalPublicLessons || totalLessons,
          reportedLessons: reportedLessonsCount,
          todayLessons,
          lessonGrowth,
          userGrowth,
          activeContributors
        });
      } catch (error) {
        console.error("Error fetching admin stats:", error);
        res.status(500).json({
          success: false,
          message: "Failed to fetch admin statistics",
          error: error.message
        });
      }
    });

    // --- ADMIN: GET ALL USERS ---
    app.get('/api/admin/users', async (req, res) => {
      try {
        const usersCollection = db.collection("user");
        const users = await usersCollection.find({}).sort({ createdAt: -1 }).toArray();
        res.status(200).send(users);
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).send({ success: false, message: "Failed to fetch users" });
      }
    });

    // --- ADMIN: UPDATE USER (Role, Plan/Subscription, Status) ---
    app.patch('/api/admin/users/:id', async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ success: false, message: "Invalid user ID format" });
        }

        const updateFields = { updatedAt: new Date() };
        const allowedFields = ['role', 'plan', 'status', 'name'];
        
        allowedFields.forEach(field => {
          if (req.body[field] !== undefined) {
            updateFields[field] = req.body[field];
          }
        });

        const result = await db.collection("user").updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ success: false, message: "User not found" });
        }

        res.status(200).send({ 
          success: true, 
          message: "User updated successfully" 
        });

      } catch (error) {
        console.error("Error updating user:", error);
        res.status(500).send({ 
          success: false, 
          message: "Failed to update user",
          error: error.message 
        });
      }
    });

    // --- ADMIN: DELETE USER ---
    app.delete('/api/admin/users/:id', async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ success: false, message: "Invalid user ID format" });
        }

        const result = await db.collection("user").deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
          return res.status(404).send({ success: false, message: "User not found" });
        }

        res.status(200).send({
          success: true,
          message: "User deleted successfully"
        });

      } catch (error) {
        console.error("Error deleting user:", error);
        res.status(500).send({
          success: false,
          message: "Failed to delete user",
          error: error.message
        });
      }
    });

  } catch (error) {
    console.error("Failed to connect to MongoDB", error);
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Digital Life Lessons API is running!");
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});