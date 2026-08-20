const express = require("express");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
const dotenv = require("dotenv");
dotenv.config();
//strucked comments are done by AI to understand easily
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;
const uri = process.env.MONGODB_URI;

const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";
const JWKS = createRemoteJWKSet(new URL(`${clientUrl}/api/auth/jwks`));

app.use(
  cors({
    origin: ["http://localhost:3000", process.env.CLIENT_URL || "*"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  }),
);
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Authentication Middleware
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

async function run() {
  try {
    await client.connect();
    const db = client.db("digitallessons");

    const lessonsCollection = db.collection("lessons");
    const usersCollection = db.collection("user");
    const reportsCollection = db.collection("reports");
    const commentsCollection = db.collection("comments");

    console.log("Connected to MongoDB database: digitallessons");

    // ==========================================
    // 1. LESSON CRUD & USER DASHBOARD
    // ==========================================

    // CREATE LESSON
    app.post("/api/add-lesson", verifyToken, async (req, res) => {
      try {
        const lesson = req.body;
        const verifiedUser = req.user;

        let isAdmin = verifiedUser.role === "admin";
        if (!isAdmin && lesson.creatorId) {
          const userQuery = {
            $or: [
              { _id: lesson.creatorId },
              ...(ObjectId.isValid(lesson.creatorId)
                ? [{ _id: new ObjectId(lesson.creatorId) }]
                : []),
            ],
          };
          const userDoc = await usersCollection.findOne(userQuery);
          isAdmin = userDoc?.role === "admin";
        }

        const newLesson = {
          title: lesson.title.trim(),
          description: lesson.description.trim(),
          category: lesson.category,
          emotionalTone: lesson.emotionalTone || "Motivational",
          visibility: lesson.visibility || "Public",
          accessLevel: lesson.accessLevel || "Free",
          creatorId: lesson.creatorId || verifiedUser.id || verifiedUser.sub,
          coverImage: lesson.coverImage || "",
          likes: [],
          likesCount: 0,
          savedBy: [],
          isFeatured: isAdmin ? Boolean(lesson.isFeatured) : false,
          isReviewed: isAdmin,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await lessonsCollection.insertOne(newLesson);
        return res.status(201).json({
          success: true,
          insertedId: result.insertedId,
          isReviewed: newLesson.isReviewed,
        });
      } catch (error) {
        console.error("Error adding lesson:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to create lesson",
          error: error.message,
        });
      }
    });

    // GET MY LESSONS (All lessons including pending review)
    app.get("/api/my-lessons/:creatorId", verifyToken, async (req, res) => {
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

        return res.status(200).json(lessons);
      } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
      }
    });

    // UPDATE LESSON
    app.patch("/api/update-lesson/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res
            .status(400)
            .json({ success: false, message: "Invalid lesson ID format" });
        }

        const updateFields = { updatedAt: new Date() };
        const allowedFields = [
          "title",
          "description",
          "category",
          "emotionalTone",
          "visibility",
          "accessLevel",
          "coverImage",
          "isFeatured",
          "isReviewed",
        ];

        allowedFields.forEach((field) => {
          if (req.body[field] !== undefined) {
            updateFields[field] = req.body[field];
          }
        });

        const result = await lessonsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields },
        );

        if (result.matchedCount === 0) {
          return res
            .status(404)
            .json({ success: false, message: "Lesson not found" });
        }

        return res.status(200).json({
          success: true,
          message: "Lesson updated successfully",
          result,
        });
      } catch (error) {
        console.error("Error updating lesson:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to update lesson",
          error: error.message,
        });
      }
    });

    // DELETE LESSON (With Cascade Report Resolution)
    app.delete("/api/lessons/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;

        const lessonQuery = {
          $or: [
            { _id: id },
            ...(ObjectId.isValid(id) ? [{ _id: new ObjectId(id) }] : []),
          ],
        };

        const deleteResult = await lessonsCollection.deleteOne(lessonQuery);

        if (deleteResult.deletedCount === 0) {
          return res
            .status(404)
            .json({ success: false, message: "Lesson not found" });
        }

        // Auto-resolve open report tickets
        await reportsCollection.updateMany(
          {
            $or: [
              { lessonId: id },
              ...(ObjectId.isValid(id) ? [{ lessonId: new ObjectId(id) }] : []),
            ],
          },
          {
            $set: {
              status: "resolved",
              actionTaken: "lesson_deleted",
              resolvedAt: new Date(),
              updatedAt: new Date(),
            },
          },
        );

        return res.status(200).json({
          success: true,
          message:
            "Lesson permanently deleted and associated reports resolved.",
        });
      } catch (error) {
        console.error("Error deleting lesson:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to delete lesson",
          error: error.message,
        });
      }
    });

    // GET SAVED LESSONS (With Author Enrichment)
    app.get("/api/saved-lessons/:userId", verifyToken, async (req, res) => {
      try {
        const { userId } = req.params;

        const query = {
          $or: [
            { savedBy: userId },
            ...(ObjectId.isValid(userId)
              ? [{ savedBy: new ObjectId(userId) }]
              : []),
          ],
        };

        const lessons = await lessonsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        if (!lessons.length) return res.status(200).json([]);

        const creatorIds = [
          ...new Set(
            lessons
              .map((l) => l.creatorId || l.userId || l.authorId)
              .filter(Boolean),
          ),
        ];
        const objectIdCreatorIds = creatorIds
          .filter((id) => ObjectId.isValid(id))
          .map((id) => new ObjectId(id));

        const users = await usersCollection
          .find({
            $or: [
              { _id: { $in: creatorIds } },
              { _id: { $in: objectIdCreatorIds } },
            ],
          })
          .toArray();

        const userMap = {};
        users.forEach((u) => {
          userMap[u._id.toString()] = {
            name: u.name || u.displayName || u.email || "Community Creator",
            image: u.image || "",
          };
        });

        const enrichedLessons = lessons.map((lesson) => {
          const cId = (
            lesson.creatorId ||
            lesson.userId ||
            lesson.authorId
          )?.toString();
          const author = userMap[cId];

          return {
            ...lesson,
            creatorName:
              lesson.creatorName || author?.name || "Community Creator",
            creatorAvatar: lesson.creatorAvatar || author?.image || "",
          };
        });

        return res.status(200).json(enrichedLessons);
      } catch (error) {
        console.error("Error fetching saved lessons:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch saved lessons",
          error: error.message,
        });
      }
    });

    // ==========================================
    // 2. ENGAGEMENT (LIKE, BOOKMARK, COMMENTS, REPORT)
    // ==========================================

    // TOGGLE LIKE
    app.post("/api/lessons/:id/like", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { userId } = req.body;

        if (!ObjectId.isValid(id) || !userId) {
          return res
            .status(400)
            .json({ success: false, message: "Invalid ID or User ID missing" });
        }

        const lesson = await lessonsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!lesson) {
          return res
            .status(404)
            .json({ success: false, message: "Lesson not found" });
        }

        const likes = lesson.likes || [];
        const isAlreadyLiked = likes.includes(userId);

        const updateQuery = isAlreadyLiked
          ? { $pull: { likes: userId }, $inc: { likesCount: -1 } }
          : { $addToSet: { likes: userId }, $inc: { likesCount: 1 } };

        const updatedLesson = await lessonsCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          updateQuery,
          { returnDocument: "after" },
        );

        return res.status(200).json({
          success: true,
          isLiked: !isAlreadyLiked,
          likesCount: updatedLesson.likesCount,
        });
      } catch (error) {
        console.error("Error toggling like:", error);
        return res.status(500).json({
          success: false,
          message: "Server error while updating like",
        });
      }
    });

    // TOGGLE BOOKMARK
    app.post("/api/lessons/:id/bookmark", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { userId } = req.body;

        if (!ObjectId.isValid(id) || !userId) {
          return res
            .status(400)
            .json({ success: false, message: "Invalid ID or User ID missing" });
        }

        const lesson = await lessonsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!lesson) {
          return res
            .status(404)
            .json({ success: false, message: "Lesson not found" });
        }

        const savedBy = lesson.savedBy || [];
        const isAlreadyBookmarked = savedBy.includes(userId);

        const updateQuery = isAlreadyBookmarked
          ? { $pull: { savedBy: userId } }
          : { $addToSet: { savedBy: userId } };

        await lessonsCollection.updateOne(
          { _id: new ObjectId(id) },
          updateQuery,
        );

        return res.status(200).json({
          success: true,
          isBookmarked: !isAlreadyBookmarked,
          message: isAlreadyBookmarked
            ? "Bookmark removed"
            : "Lesson bookmarked successfully!",
        });
      } catch (error) {
        console.error("Error toggling bookmark:", error);
        return res.status(500).json({
          success: false,
          message: "Server error while bookmarking",
        });
      }
    });

    // GET COMMENTS
    app.get("/api/comments/:lessonId", verifyToken, async (req, res) => {
      try {
        const { lessonId } = req.params;

        const comments = await commentsCollection
          .aggregate([
            { $match: { lessonId: lessonId } },
            { $sort: { createdAt: -1 } },
            {
              $lookup: {
                from: "user",
                localField: "userId",
                foreignField: "_id",
                as: "creatorInfo",
              },
            },
            {
              $unwind: {
                path: "$creatorInfo",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $project: {
                text: 1,
                createdAt: 1,
                creatorName: "$creatorInfo.name",
                creatorAvatar: "$creatorInfo.image",
              },
            },
          ])
          .toArray();

        return res.status(200).json(comments);
      } catch (error) {
        console.error("Error fetching comments:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch comments",
        });
      }
    });

    // POST COMMENT
    app.post("/api/comments", verifyToken, async (req, res) => {
      try {
        const { lessonId, userId, text } = req.body;

        if (!lessonId || !userId || !text?.trim()) {
          return res
            .status(400)
            .json({ success: false, message: "Missing required fields" });
        }

        let finalUserId = userId;
        if (
          ObjectId.isValid(userId) &&
          String(new ObjectId(userId)) === userId
        ) {
          finalUserId = new ObjectId(userId);
        }

        const newComment = {
          lessonId: lessonId,
          userId: finalUserId,
          text: text.trim(),
          createdAt: new Date(),
        };

        const result = await commentsCollection.insertOne(newComment);
        return res.status(201).json({
          _id: result.insertedId,
          ...newComment,
        });
      } catch (error) {
        console.error("Error posting comment:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to post comment",
          error: error.message,
        });
      }
    });

    // SUBMIT REPORT
    app.post("/api/lessons/:id/report", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { reporterUserId, reportedUserEmail, reason, details } = req.body;

        const targetLesson = await lessonsCollection.findOne({
          $or: [
            { _id: id },
            ...(ObjectId.isValid(id) ? [{ _id: new ObjectId(id) }] : []),
          ],
        });

        let creatorName = targetLesson?.creatorName || targetLesson?.authorName;
        const creatorId =
          targetLesson?.creatorId ||
          targetLesson?.userId ||
          targetLesson?.authorId;

        if (!creatorName && creatorId) {
          const authorUser = await usersCollection.findOne({
            $or: [
              { _id: creatorId.toString() },
              ...(ObjectId.isValid(creatorId)
                ? [{ _id: new ObjectId(creatorId) }]
                : []),
            ],
          });
          creatorName = authorUser?.name || authorUser?.email;
        }

        const newReport = {
          lessonId: id,
          lessonTitle: targetLesson?.title || "Untitled Lesson",
          creatorId: creatorId ? creatorId.toString() : null,
          creatorName: creatorName || "Community Creator",
          reporterUserId: reporterUserId,
          reporterEmail: reportedUserEmail || "Anonymous",
          reason: reason,
          details: details || "",
          status: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await reportsCollection.insertOne(newReport);
        return res.status(201).json({
          success: true,
          message: "Report submitted successfully.",
          reportId: result.insertedId,
        });
      } catch (error) {
        console.error("Error submitting report:", error);
        return res.status(500).json({ success: false, message: error.message });
      }
    });

    // ==========================================
    // 3. PUBLIC EXPLORE & DISCOVERY ROUTES
    // ==========================================

    app.get("/api/lessons/featured", async (req, res) => {
      try {
        const lessons = await lessonsCollection
          .find({
            visibility: "Public",
            isFeatured: true,
            isReviewed: true,
          })
          .sort({ createdAt: -1 })
          .limit(8)
          .toArray();

        const creatorIds = [
          ...new Set(lessons.map((l) => l.creatorId).filter(Boolean)),
        ];
        const objectIdCreatorIds = creatorIds
          .filter((id) => ObjectId.isValid(id))
          .map((id) => new ObjectId(id));

        const users = await usersCollection
          .find({
            $or: [
              { _id: { $in: creatorIds } },
              { _id: { $in: objectIdCreatorIds } },
            ],
          })
          .toArray();

        const userMap = {};
        users.forEach((user) => {
          userMap[user._id.toString()] = {
            name: user.name || user.email || "Anonymous",
            image: user.image || "",
          };
        });

        const enrichedLessons = lessons.map((lesson) => {
          const creator = userMap[lesson.creatorId] || {
            name: "Anonymous",
            image: "",
          };
          return {
            ...lesson,
            creatorName: creator.name,
            creatorAvatar: creator.image,
          };
        });

        return res.status(200).json(enrichedLessons);
      } catch (error) {
        console.error("Error fetching featured lessons:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch featured lessons",
          error: error.message,
        });
      }
    });
    app.get("/api/lessons/most-saved", async (req, res) => {
      try {
        const mostSaved = await lessonsCollection
          .aggregate([
            {
              $match: {
                visibility: "Public",
                isReviewed: true,
              },
            },
            {
              $addFields: {
                savesCount: {
                  $cond: {
                    if: { $isArray: "$savedBy" },
                    then: { $size: "$savedBy" },
                    else: 0,
                  },
                },
              },
            },
            { $sort: { savesCount: -1, likesCount: -1, createdAt: -1 } },
            { $limit: 4 },
          ])
          .toArray();

        const creatorIds = mostSaved
          .map((l) => l.creatorId || l.userId || l.authorId)
          .filter(Boolean);

        const objectIdCreatorIds = creatorIds
          .filter((id) => ObjectId.isValid(id))
          .map((id) => new ObjectId(id));

        const users = await usersCollection
          .find({
            $or: [
              { _id: { $in: creatorIds } },
              { _id: { $in: objectIdCreatorIds } },
            ],
          })
          .toArray();

        const userMap = {};
        users.forEach((u) => {
          userMap[u._id.toString()] = {
            name: u.name || u.email || "Community Creator",
            image: u.image || "",
          };
        });

        const enrichedLessons = mostSaved.map((lesson) => {
          const cId = (
            lesson.creatorId ||
            lesson.userId ||
            lesson.authorId
          )?.toString();
          const author = userMap[cId];

          return {
            ...lesson,
            creatorName:
              lesson.creatorName || author?.name || "Community Creator",
            creatorAvatar: lesson.creatorAvatar || author?.image || "",
          };
        });

        return res.status(200).json(enrichedLessons);
      } catch (error) {
        console.error("Error fetching most saved lessons:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch most saved lessons",
          error: error.message,
        });
      }
    });

    // GET ALL PUBLIC LESSONS (Filter, Search, Pagination)
    app.get("/api/lessons", async (req, res) => {
      try {
        const {
          search = "",
          category = "All",
          emotionalTone = "All",
          accessLevel = "All",
          visibility = "Public",
          sortBy = "newest",
          page = 1,
          limit = 0,
        } = req.query;

        const query = {};

        if (visibility !== "all") {
          query.visibility = { $regex: new RegExp(`^${visibility}$`, "i") };
        }
        if (category && category !== "All") query.category = category;
        if (emotionalTone && emotionalTone !== "All")
          query.emotionalTone = emotionalTone;
        if (accessLevel && accessLevel !== "All")
          query.accessLevel = accessLevel;

        if (search.trim()) {
          const searchRegex = new RegExp(search.trim(), "i");
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
            {
              creatorId: {
                $in: [...matchingUserIds, ...matchingUserObjectIds],
              },
            },
          ];
        }

        let sortOptions = { createdAt: -1 };
        if (sortBy === "oldest") sortOptions = { createdAt: 1 };
        else if (sortBy === "popular")
          sortOptions = { views: -1, likesCount: -1 };

        const pageNumber = Math.max(1, parseInt(page, 10) || 1);
        const limitNumber = parseInt(limit, 10) || 0;
        const skip = limitNumber > 0 ? (pageNumber - 1) * limitNumber : 0;

        const totalLessons = await lessonsCollection.countDocuments(query);
        let lessonsCursor = lessonsCollection
          .find(query)
          .sort(sortOptions)
          .skip(skip);

        if (limitNumber > 0) lessonsCursor = lessonsCursor.limit(limitNumber);
        const lessons = await lessonsCursor.toArray();

        const creatorIds = [
          ...new Set(
            lessons
              .map((lesson) => lesson.creatorId || lesson.userId)
              .filter(Boolean),
          ),
        ];
        const objectIdCreatorIds = creatorIds
          .filter((id) => ObjectId.isValid(id))
          .map((id) => new ObjectId(id));

        const users = await usersCollection
          .find({
            $or: [
              { _id: { $in: creatorIds } },
              { _id: { $in: objectIdCreatorIds } },
            ],
          })
          .toArray();

        const userMap = {};
        users.forEach((user) => {
          userMap[user._id.toString()] = {
            name: user.name || "Anonymous Creator",
            image: user.image || "",
          };
        });

        const enrichedLessons = lessons.map((lesson) => {
          const creatorIdStr = (lesson.creatorId || lesson.userId)?.toString();
          const creator = userMap[creatorIdStr] || {
            name: lesson.creatorName || "Anonymous Creator",
            image: lesson.creatorAvatar || "",
          };

          return {
            ...lesson,
            creatorName: creator.name,
            creatorAvatar: creator.image,
          };
        });

        if (limitNumber > 0) {
          return res.status(200).json({
            success: true,
            total: totalLessons,
            page: pageNumber,
            totalPages: Math.ceil(totalLessons / limitNumber),
            data: enrichedLessons,
          });
        }

        return res.status(200).json(enrichedLessons);
      } catch (error) {
        console.error("Error fetching lessons:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch query-based lessons",
          error: error.message,
        });
      }
    });
    // GET SINGLE LESSON

    // GET FEATURED LESSONS

    // GET AUTHOR PROFILE & PUBLIC LESSONS
    app.get("/api/author-profile/:id", async (req, res) => {
      try {
        const { id } = req.params;

        if (!id || id === "undefined") {
          return res
            .status(400)
            .json({ success: false, message: "Valid Author ID is required" });
        }

        const userDoc = await usersCollection.findOne({
          $or: [
            { _id: id },
            ...(ObjectId.isValid(id) ? [{ _id: new ObjectId(id) }] : []),
          ],
        });

        const author = {
          id: id,
          name: userDoc?.name || userDoc?.email || "Anonymous Creator",
          image: userDoc?.image || "",
          role: userDoc?.role || "user",
        };

        const lessons = await lessonsCollection
          .find({
            $or: [
              { creatorId: id },
              { userId: id },
              { authorId: id },
              ...(ObjectId.isValid(id)
                ? [
                    { creatorId: new ObjectId(id) },
                    { userId: new ObjectId(id) },
                    { authorId: new ObjectId(id) },
                  ]
                : []),
            ],
            visibility: "Public",
          })
          .sort({ createdAt: -1 })
          .toArray();

        const enrichedLessons = lessons.map((lesson) => ({
          ...lesson,
          creatorName: author.name,
          creatorAvatar: author.image,
        }));

        return res.status(200).json({
          success: true,
          author,
          lessons: enrichedLessons,
        });
      } catch (error) {
        console.error("Error fetching author profile:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch author profile",
          error: error.message,
        });
      }
    });

    // GET TOP CONTRIBUTORS OF THE WEEK
    // --- GET TOP CONTRIBUTORS OF THE WEEK ---
    app.get("/api/top-contributors", async (req, res) => {
      try {
        const usersCollection = db.collection("user");
        const lessonsCollection = db.collection("lessons");

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        // 1. Group by stringified creatorId to prevent ObjectId vs String duplicates
        let topCreators = await lessonsCollection
          .aggregate([
            {
              $match: {
                creatorId: { $ne: null },
                createdAt: { $gte: sevenDaysAgo },
              },
            },
            {
              $group: {
                _id: { $toString: "$creatorId" }, // 👈 Normalizes ObjectId & String
                recentLessons: { $sum: 1 },
                totalLikes: { $sum: { $ifNull: ["$likesCount", 0] } },
              },
            },
            { $sort: { recentLessons: -1, totalLikes: -1 } },
            { $limit: 4 },
          ])
          .toArray();

        // Fallback: If fewer than 4 published this week, fetch all-time top contributors
        if (topCreators.length < 4) {
          topCreators = await lessonsCollection
            .aggregate([
              { $match: { creatorId: { $ne: null } } },
              {
                $group: {
                  _id: { $toString: "$creatorId" }, // 👈 Normalizes ObjectId & String
                  recentLessons: { $sum: 1 },
                  totalLikes: { $sum: { $ifNull: ["$likesCount", 0] } },
                },
              },
              { $sort: { recentLessons: -1, totalLikes: -1 } },
              { $limit: 4 },
            ])
            .toArray();
        }

        const creatorIds = topCreators.map((c) => c._id);
        const objectIdCreatorIds = creatorIds
          .filter((id) => ObjectId.isValid(id))
          .map((id) => new ObjectId(id));

        const matchedUsers = await usersCollection
          .find({
            $or: [
              { _id: { $in: creatorIds } },
              { _id: { $in: objectIdCreatorIds } },
            ],
          })
          .toArray();

        const userMap = {};
        matchedUsers.forEach((u) => {
          userMap[u._id.toString()] = {
            name: u.name || "Anonymous Creator",
            image: u.image || "",
            role: u.role || "Creator",
            headline:
              u.headline ||
              (u.role === "admin" ? "Platform Educator" : "Wisdom Contributor"),
          };
        });

        const result = topCreators.map((creator) => {
          const user = userMap[creator._id] || {
            name: "Community Creator",
            image: "",
            role: "Creator",
            headline: "Wisdom Contributor",
          };

          return {
            userId: creator._id,
            name: user.name,
            image: user.image,
            headline: user.headline,
            lessonsCount: creator.recentLessons,
            totalLikes: creator.totalLikes,
          };
        });

        return res.status(200).json(result);
      } catch (error) {
        console.error("Error fetching top contributors:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to load top contributors",
          error: error.message,
        });
      }
    });

    // GET MOST SAVED LESSONS

    // ==========================================
    // 4. ADMIN DASHBOARD & USER MANAGEMENT
    // ==========================================

    // ADMIN: GET ALL LESSONS
    app.get("/api/lessons/admin-all", verifyToken, async (req, res) => {
      try {
        const lessons = await lessonsCollection
          .find({})
          .sort({ createdAt: -1 })
          .toArray();

        const creatorIds = [
          ...new Set(lessons.map((lesson) => lesson.creatorId).filter(Boolean)),
        ];
        const objectIdCreatorIds = creatorIds
          .filter((id) => ObjectId.isValid(id))
          .map((id) => new ObjectId(id));

        const users = await usersCollection
          .find({
            $or: [
              { _id: { $in: creatorIds } },
              { _id: { $in: objectIdCreatorIds } },
            ],
          })
          .toArray();

        const userMap = {};
        users.forEach((user) => {
          userMap[user._id.toString()] = {
            name: user.name || "Anonymous",
            image: user.image || "",
          };
        });

        const enrichedLessons = lessons.map((lesson) => {
          const creator = userMap[lesson.creatorId] || {
            name: "Anonymous",
            image: "",
          };
          return {
            ...lesson,
            creatorName: creator.name,
            creatorAvatar: creator.image,
          };
        });

        return res.status(200).json(enrichedLessons);
      } catch (error) {
        console.error("Error fetching admin lessons:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch admin lessons",
          error: error.message,
        });
      }
    });
    app.get("/api/lessons/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res
            .status(400)
            .json({ success: false, message: "Invalid Lesson ID" });
        }

        const lesson = await lessonsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!lesson) {
          return res
            .status(404)
            .json({ success: false, message: "Lesson not found" });
        }

        const creatorId =
          lesson.creatorId || lesson.userId || lesson.authorId || null;
        let creatorName = lesson.creatorName || "Anonymous";
        let creatorAvatar = "";

        if (creatorId) {
          const userDoc = await usersCollection.findOne({
            $or: [
              { _id: creatorId },
              ...(ObjectId.isValid(creatorId)
                ? [{ _id: new ObjectId(creatorId) }]
                : []),
            ],
          });
          if (userDoc) {
            creatorName = userDoc.name || userDoc.email || creatorName;
            creatorAvatar = userDoc.image || "";
          }
        }

        return res.status(200).json({
          ...lesson,
          creatorId: creatorId ? creatorId.toString() : null,
          creatorName,
          creatorAvatar,
        });
      } catch (error) {
        console.error("Error fetching lesson:", error);
        return res.status(500).json({
          success: false,
          message: "Server error",
          error: error.message,
        });
      }
    });

    // ADMIN: GET PLATFORM STATS
    app.get("/api/admin/stats", verifyToken, async (req, res) => {
      try {
        const now = new Date();
        const startOfToday = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
        );
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        sevenDaysAgo.setHours(0, 0, 0, 0);

        const [
          totalUsers,
          totalLessons,
          totalPublicLessons,
          openReports,
          todayLessons,
        ] = await Promise.all([
          usersCollection.countDocuments(),
          lessonsCollection.countDocuments(),
          lessonsCollection.countDocuments({
            $or: [
              { visibility: "Public" },
              { visibility: { $regex: /^public$/i } },
              { visibility: { $exists: false } },
            ],
          }),
          reportsCollection
            .find({
              status: { $not: { $regex: /^resolved$/i } },
            })
            .toArray(),
          lessonsCollection.countDocuments({
            createdAt: { $gte: startOfToday },
          }),
        ]);

        const uniqueReportedLessons = new Set(
          openReports.map((r) => r.lessonId?.toString()).filter(Boolean),
        );
        const reportedLessonsCount =
          uniqueReportedLessons.size || openReports.length;

        const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const last7Days = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          last7Days.push({
            dateStr: d.toISOString().split("T")[0],
            dayName: daysOfWeek[d.getDay()],
          });
        }

        const recentLessons = await lessonsCollection
          .find({ createdAt: { $gte: sevenDaysAgo } })
          .toArray();

        const lessonGrowthMap = {};
        last7Days.forEach((d) => {
          lessonGrowthMap[d.dateStr] = 0;
        });
        recentLessons.forEach((lesson) => {
          if (lesson.createdAt) {
            const dateStr = new Date(lesson.createdAt)
              .toISOString()
              .split("T")[0];
            if (lessonGrowthMap[dateStr] !== undefined) {
              lessonGrowthMap[dateStr]++;
            }
          }
        });
        const lessonGrowth = last7Days.map((d) => ({
          day: d.dayName,
          count: lessonGrowthMap[d.dateStr] || 0,
        }));

        const recentUsers = await usersCollection
          .find({ createdAt: { $gte: sevenDaysAgo } })
          .toArray();

        const userGrowthMap = {};
        last7Days.forEach((d) => {
          userGrowthMap[d.dateStr] = 0;
        });
        recentUsers.forEach((u) => {
          if (u.createdAt) {
            const dateStr = new Date(u.createdAt).toISOString().split("T")[0];
            if (userGrowthMap[dateStr] !== undefined) {
              userGrowthMap[dateStr]++;
            }
          }
        });
        const userGrowth = last7Days.map((d) => ({
          day: d.dayName,
          count: userGrowthMap[d.dateStr] || 0,
        }));

        const topAgg = await lessonsCollection
          .aggregate([
            { $match: { creatorId: { $ne: null } } },
            {
              $group: {
                _id: { $toString: "$creatorId" }, // 👈 ADD THIS: Normalizes both String and ObjectId
                count: { $sum: 1 },
              },
            },
            { $sort: { count: -1 } },
            { $limit: 5 },
          ])
          .toArray();

        const creatorIds = topAgg.map((t) => t._id);
        const objectIdCreatorIds = creatorIds
          .filter((id) => ObjectId.isValid(id))
          .map((id) => new ObjectId(id));

        const matchedUsers = await usersCollection
          .find({
            $or: [
              { _id: { $in: creatorIds } },
              { _id: { $in: objectIdCreatorIds } },
            ],
          })
          .toArray();

        const userLookup = {};
        matchedUsers.forEach((u) => {
          userLookup[u._id.toString()] = u;
        });

        const activeContributors = topAgg.map((item) => {
          const u = userLookup[item._id?.toString()];
          return {
            userId: item._id,
            name: u?.name || "Community Creator",
            email: u?.email || "",
            image: u?.image || "",
            role: u?.role || "user",
            lessonsCount: item.count,
          };
        });

        return res.status(200).json({
          success: true,
          totalUsers,
          totalLessons,
          totalPublicLessons: totalPublicLessons || totalLessons,
          reportedLessons: reportedLessonsCount,
          todayLessons,
          lessonGrowth,
          userGrowth,
          activeContributors,
        });
      } catch (error) {
        console.error("Error fetching admin stats:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to fetch admin statistics",
          error: error.message,
        });
      }
    });

    // ADMIN: GET ALL REPORTS
    app.get("/api/admin/reports", verifyToken, async (req, res) => {
      try {
        const reports = await reportsCollection
          .find({})
          .sort({ createdAt: -1 })
          .toArray();

        if (!reports.length) return res.status(200).json([]);

        const rawLessonIds = reports.map((r) => r.lessonId).filter(Boolean);
        const lessonQueryIds = [];
        rawLessonIds.forEach((id) => {
          lessonQueryIds.push(id.toString());
          if (ObjectId.isValid(id)) {
            try {
              lessonQueryIds.push(new ObjectId(id));
            } catch (e) {}
          }
        });

        const lessons = await lessonsCollection
          .find({ _id: { $in: lessonQueryIds } })
          .toArray();

        const lessonMap = {};
        const rawUserIds = [];

        lessons.forEach((l) => {
          lessonMap[l._id.toString()] = l;
          const uid = l.creatorId || l.userId || l.authorId;
          if (uid) rawUserIds.push(uid);
        });

        reports.forEach((r) => {
          if (r.creatorId) rawUserIds.push(r.creatorId);
          if (r.reporterUserId) rawUserIds.push(r.reporterUserId);
        });

        const userQueryIds = [];
        rawUserIds.forEach((id) => {
          userQueryIds.push(id.toString());
          if (ObjectId.isValid(id)) {
            try {
              userQueryIds.push(new ObjectId(id));
            } catch (e) {}
          }
        });

        const userMap = {};
        if (userQueryIds.length > 0) {
          const users = await usersCollection
            .find({ _id: { $in: userQueryIds } })
            .toArray();

          users.forEach((u) => {
            userMap[u._id.toString()] =
              u.name || u.displayName || u.email || "Community Author";
          });
        }

        const enrichedReports = reports.map((report) => {
          const matchedLesson = lessonMap[report.lessonId?.toString()];
          const creatorId = (
            matchedLesson?.creatorId ||
            matchedLesson?.userId ||
            matchedLesson?.authorId ||
            report.creatorId
          )?.toString();

          const authorName =
            matchedLesson?.creatorName ||
            matchedLesson?.authorName ||
            (creatorId ? userMap[creatorId] : null) ||
            report.authorName ||
            report.creatorName ||
            "Community Creator";

          return {
            ...report,
            lessonTitle:
              matchedLesson?.title || report.lessonTitle || "Untitled Lesson",
            authorName,
            creatorName: authorName,
            reporterEmail: report.reporterEmail || "Anonymous",
          };
        });

        return res.status(200).json(enrichedReports);
      } catch (error) {
        console.error("Error fetching admin reports:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to load reports",
          error: error.message,
        });
      }
    });

    // ADMIN: BATCH RESOLVE REPORTS
    app.patch(
      "/api/admin/reports/lesson/:lessonId/resolve",
      verifyToken,
      async (req, res) => {
        try {
          const { lessonId } = req.params;

          const filter = {
            $or: [
              { lessonId: lessonId },
              ...(ObjectId.isValid(lessonId)
                ? [{ lessonId: new ObjectId(lessonId) }]
                : []),
            ],
          };

          const result = await reportsCollection.updateMany(filter, {
            $set: {
              status: "resolved",
              resolvedAt: new Date(),
              updatedAt: new Date(),
            },
          });

          return res.status(200).json({
            success: true,
            message: "All reports for this lesson marked as resolved.",
            modifiedCount: result.modifiedCount,
          });
        } catch (error) {
          console.error("Error resolving lesson reports:", error);
          return res.status(500).json({
            success: false,
            message: "Failed to resolve reports",
            error: error.message,
          });
        }
      },
    );

    // ADMIN: GET ALL USERS
    app.get("/api/admin/users", verifyToken, async (req, res) => {
      try {
        const users = await usersCollection
          .find({})
          .sort({ createdAt: -1 })
          .toArray();
        return res.status(200).json(users);
      } catch (error) {
        console.error("Error fetching users:", error);
        return res
          .status(500)
          .json({ success: false, message: "Failed to fetch users" });
      }
    });

    // ADMIN: UPDATE USER
    app.patch("/api/admin/users/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res
            .status(400)
            .json({ success: false, message: "Invalid user ID format" });
        }

        const updateFields = { updatedAt: new Date() };
        const allowedFields = ["role", "plan", "status", "name"];

        allowedFields.forEach((field) => {
          if (req.body[field] !== undefined) {
            updateFields[field] = req.body[field];
          }
        });

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields },
        );

        if (result.matchedCount === 0) {
          return res
            .status(404)
            .json({ success: false, message: "User not found" });
        }

        return res.status(200).json({
          success: true,
          message: "User updated successfully",
        });
      } catch (error) {
        console.error("Error updating user:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to update user",
          error: error.message,
        });
      }
    });

    // ADMIN: DELETE USER
    app.delete("/api/admin/users/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res
            .status(400)
            .json({ success: false, message: "Invalid user ID format" });
        }

        const result = await usersCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res
            .status(404)
            .json({ success: false, message: "User not found" });
        }

        return res.status(200).json({
          success: true,
          message: "User deleted successfully",
        });
      } catch (error) {
        console.error("Error deleting user:", error);
        return res.status(500).json({
          success: false,
          message: "Failed to delete user",
          error: error.message,
        });
      }
    });

    // ==========================================
    // 5. SUBSCRIPTION & PAYMENT WEBHOOKS
    // ==========================================

    app.patch("/api/users/upgrade-plan", verifyToken, async (req, res) => {
      try {
        const { email, userId } = req.body || {};

        if (!email && !userId) {
          return res.status(400).json({
            success: false,
            message: "User email or userId is required.",
          });
        }

        let filter = {};
        if (email) {
          filter = { email: email.toLowerCase().trim() };
        } else if (userId) {
          filter = {
            $or: [
              { _id: userId },
              ...(ObjectId.isValid(userId)
                ? [{ _id: new ObjectId(userId) }]
                : []),
            ],
          };
        }

        const result = await usersCollection.updateOne(filter, {
          $set: {
            plan: "premium",
            updatedAt: new Date(),
          },
        });

        if (result.matchedCount === 0) {
          return res.status(404).json({
            success: false,
            message: "User not found in database.",
          });
        }

        return res.status(200).json({
          success: true,
          message: "User upgraded to Premium successfully.",
        });
      } catch (error) {
        console.error("[Upgrade Error]:", error);
        return res.status(500).json({
          success: false,
          message: error.message || "Internal server error.",
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
