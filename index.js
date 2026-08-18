const express = require("express");
const app = express();
const dotenv = require("dotenv");
dotenv.config();
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

app.use(cors());
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

    // --- ADD LESSON ---
    // --- CREATE / ADD LESSON (Auto-reviewed ONLY for Admins) ---
    app.post('/api/add-lesson', async (req, res) => {
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
    app.get("/api/my-lessons/:creatorId", async (req, res) => {
      try {
        const { creatorId } = req.params;
 
        if (!creatorId) {
          return res
            .status(400)
            .send({ success: false, message: "Creator ID is required" });
        }

        const query = { creatorId: new ObjectId(creatorId) };
        const lessons = await lessonsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.status(200).send(lessons);
      } catch (error) {
        console.error("Error fetching user lessons:", error);
        res.status(500).send({
          success: false,
          message: "Failed to fetch lessons",
          error: error.message,
        });
      }
    });

    // --- UPDATE LESSON ---
    app.patch('/api/update-lesson/:id', async (req, res) => {
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
    app.delete('/api/lessons/:id', async (req, res) => {
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
    app.get('/api/lessons', async (req, res) => {
      try {
        const lessons = await lessonsCollection
          .find({ visibility: "Public" })
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
        console.error("Error fetching lessons with creators:", error);
        res.status(500).send({ 
          success: false, 
          message: "Failed to fetch lessons",
          error: error.message 
        });
      }
    });

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
    app.get('/api/lessons/:id', async (req, res) => {
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
    app.post('/api/lessons/:id/like', async (req, res) => {
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
    app.post('/api/lessons/:id/bookmark', async (req, res) => {
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
    app.post('/api/lessons/:id/report', async (req, res) => {
      try {
        const { id } = req.params;
        const { userId, reason } = req.body;

        if (!ObjectId.isValid(id) || !userId || !reason) {
          return res.status(400).send({ success: false, message: "Missing required fields" });
        }

        let finalUserId = userId;
        if (ObjectId.isValid(userId) && String(new ObjectId(userId)) === userId) {
          finalUserId = new ObjectId(userId);
        }

        const reportDoc = {
          lessonId: new ObjectId(id),
          userId: finalUserId,
          reason: reason,
          status: "Pending",
          createdAt: new Date()
        };

        await db.collection("reports").insertOne(reportDoc);

        res.status(201).send({
          success: true,
          message: "Report submitted successfully"
        });

      } catch (error) {
        console.error("Error reporting lesson:", error);
        res.status(500).send({ success: false, message: "Server error while reporting" });
      }
    });

    // --- GET ALL REPORTS (Robust User & Lesson Matching) ---
    app.get('/api/admin/reports', async (req, res) => {
      try {
        const reportsCollection = db.collection("reports");
        const usersCollection = db.collection("user");

        const reports = await reportsCollection.find({}).sort({ createdAt: -1 }).toArray();

        const enrichedReports = await Promise.all(reports.map(async (rep) => {
          let lessonTitle = "Untitled Lesson";
          let authorName = "Anonymous";
          let userName = "Anonymous User";

          // 1. Fetch Lesson & Author Details
          if (rep.lessonId) {
            try {
              const lessonIdObj = ObjectId.isValid(rep.lessonId) ? new ObjectId(rep.lessonId) : rep.lessonId;
              const lesson = await lessonsCollection.findOne({ _id: lessonIdObj });
              
              if (lesson) {
                lessonTitle = lesson.title;
                if (lesson.creatorId) {
                  const author = await usersCollection.findOne({
                    $or: [
                      { _id: lesson.creatorId },
                      { _id: ObjectId.isValid(lesson.creatorId) ? new ObjectId(lesson.creatorId) : null },
                      { _id: String(lesson.creatorId) }
                    ]
                  });
                  if (author) authorName = author.name || author.email || "Anonymous";
                }
              }
            } catch (err) {
              console.error("Error fetching lesson for report:", err);
            }
          }

          // 2. Fetch Reporter Details (Handles both String and ObjectId user IDs)
          if (rep.userId) {
            try {
              const reporter = await usersCollection.findOne({
                $or: [
                  { _id: rep.userId },
                  { _id: ObjectId.isValid(rep.userId) ? new ObjectId(rep.userId) : null },
                  { _id: String(rep.userId) }
                ]
              });
              
              if (reporter) {
                userName = reporter.name || reporter.email || "Anonymous User";
              }
            } catch (err) {
              console.error("Error fetching reporter for report:", err);
            }
          }

          return {
            ...rep,
            lessonTitle,
            authorName,
            userName
          };
        }));

        res.status(200).send(enrichedReports);

      } catch (error) {
        console.error("Error fetching reports:", error);
        res.status(500).send({ success: false, message: "Failed to fetch reports" });
      }
    });

    // --- RESOLVE / UPDATE REPORT STATUS ---
   // --- CLEAR / RESOLVE ALL REPORTS FOR A LESSON (IGNORE ACTION) ---
    app.patch('/api/admin/reports/lesson/:lessonId/resolve', async (req, res) => {
      try {
        const { lessonId } = req.params;

        if (!ObjectId.isValid(lessonId)) {
          return res.status(400).send({ success: false, message: "Invalid lesson ID format" });
        }

        const result = await db.collection("reports").updateMany(
          { 
            $or: [
              { lessonId: new ObjectId(lessonId) },
              { lessonId: lessonId }
            ]
          },
          { 
            $set: { 
              status: "Resolved", 
              updatedAt: new Date() 
            } 
          }
        );

        res.status(200).send({ 
          success: true, 
          message: "All reports for this lesson have been cleared", 
          modifiedCount: result.modifiedCount 
        });
      } catch (error) {
        console.error("Error resolving lesson reports:", error);
        res.status(500).send({ 
          success: false, 
          message: "Failed to resolve reports", 
          error: error.message 
        });
      }
    });

    // --- GET COMMENTS FOR A LESSON ---
    app.get('/api/comments/:lessonId', async (req, res) => {
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
    app.post('/api/comments', async (req, res) => {
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
    app.get('/api/admin/stats', async (req, res) => {
      try {
        const usersCollection = db.collection("user");
        const reportsCollection = db.collection("reports");

        // 1. Basic Counts
        const totalUsers = await usersCollection.countDocuments();
        const totalPublicLessons = await lessonsCollection.countDocuments({ visibility: "Public" });
        const reportedLessons = await reportsCollection.countDocuments({ status: { $ne: "Resolved" } });
        const activeSubscriptions = await usersCollection.countDocuments({ plan: "premium" });

        // 2. Today's New Lessons
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const todayLessons = await lessonsCollection.countDocuments({
          createdAt: { $gte: startOfToday }
        });

        // 3. 7-Day Growth Trends (Lessons & Users)
        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        sevenDaysAgo.setHours(0, 0, 0, 0);

        const recentLessons = await lessonsCollection
          .find({ createdAt: { $gte: sevenDaysAgo } })
          .toArray();

        const recentUsers = await usersCollection
          .find({ createdAt: { $gte: sevenDaysAgo } })
          .toArray();

        const lessonGrowth = [];
        const userGrowth = [];

        for (let i = 6; i >= 0; i--) {
          const targetDate = new Date();
          targetDate.setDate(targetDate.getDate() - i);
          const dayStr = dayNames[targetDate.getDay()];
          const dateOnly = targetDate.toISOString().split("T")[0];

          const lessonCount = recentLessons.filter((l) => {
            const lDate = new Date(l.createdAt).toISOString().split("T")[0];
            return lDate === dateOnly;
          }).length;

          const userCount = recentUsers.filter((u) => {
            const uDate = u.createdAt ? new Date(u.createdAt).toISOString().split("T")[0] : null;
            return uDate === dateOnly;
          }).length;

          lessonGrowth.push({ day: dayStr, count: lessonCount });
          userGrowth.push({ day: dayStr, count: userCount });
        }

        // 4. Most Active Contributors
        const contributorAgg = await lessonsCollection.aggregate([
          { $match: { creatorId: { $ne: null } } },
          { $group: { _id: "$creatorId", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 5 }
        ]).toArray();

        const creatorIds = contributorAgg.map(c => c._id);
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
            name: u.name || "Anonymous",
            email: u.email || "",
            image: u.image || "",
            role: u.role || "user"
          };
        });

        const activeContributors = contributorAgg.map(item => {
          const userDetails = userMap[item._id?.toString()] || { name: "Anonymous", email: "", image: "", role: "user" };
          return {
            userId: item._id,
            name: userDetails.name,
            email: userDetails.email,
            image: userDetails.image,
            role: userDetails.role,
            lessonsCount: item.count
          };
        });

        res.status(200).send({
          success: true,
          totalUsers,
          totalPublicLessons,
          reportedLessons,
          activeSubscriptions,
          todayLessons,
          lessonGrowth,
          userGrowth,
          activeContributors
        });

      } catch (error) {
        console.error("Error fetching admin stats:", error);
        res.status(500).send({ 
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