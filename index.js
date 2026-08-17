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
    app.post("/api/add-lesson", async (req, res) => {
      try {
        const {
          title,
          description,
          category,
          emotionalTone,
          visibility,
          accessLevel,
          creatorId,
          coverImage,
        } = req.body;

        const newLesson = {
          title,
          description,
          category,
          emotionalTone: emotionalTone || "Motivational",
          visibility: visibility || "Public",
          accessLevel: accessLevel || "Free",
          creatorId: creatorId ? new ObjectId(creatorId) : null,
          coverImage: coverImage || "",
          likes: [],
          likesCount: 0,
          savedBy: [],
          isFeatured: false,
          isReviewed: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await lessonsCollection.insertOne(newLesson);
        res.status(201).send(result);
      } catch (error) {
        console.error("Error adding lesson:", error);
        res.status(500).send({
          success: false,
          message: "Failed to add lesson",
          error: error.message,
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
    app.get('/api/lessons/featured', async (req, res) => {
      try {
        const lessons = await lessonsCollection
          .find({ visibility: "Public", isFeatured: true })
          .sort({ createdAt: -1 })
          .limit(5)
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
        console.error("Error fetching featured lessons:", error);
        res.status(500).send({ 
          success: false, 
          message: "Failed to fetch featured lessons",
          error: error.message 
        });
      }
    });

    // --- GET SINGLE LESSON BY ID ---
    app.get('/api/lessons/:id', async (req, res) => {
      try {
        const { id } = req.params;
        
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ success: false, message: "Invalid Lesson ID" });
        }

        const lessons = await lessonsCollection.aggregate([
          { $match: { _id: new ObjectId(id) } },
          {
            $lookup: {
              from: "user",
              localField: "creatorId",
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
              title: 1,
              description: 1,
              category: 1,
              emotionalTone: 1,
              visibility: 1,
              accessLevel: 1,
              coverImage: 1,
              likes: 1,
              likesCount: 1,
              savedBy: 1,
              isFeatured: 1,
              isReviewed: 1,
              createdAt: 1,
              updatedAt: 1,
              creatorName: "$creatorInfo.name",
              creatorAvatar: "$creatorInfo.image"
            }
          }
        ]).toArray();

        if (lessons.length === 0) {
          return res.status(404).send({ success: false, message: "Lesson not found" });
        }

        res.status(200).send(lessons[0]);

      } catch (error) {
        console.error("Error fetching single lesson:", error);
        res.status(500).send({ 
          success: false, 
          message: "Server error while fetching lesson",
          error: error.message 
        });
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
    app.patch('/api/admin/reports/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ success: false, message: "Invalid Report ID format" });
        }

        const result = await db.collection("reports").updateOne(
          { _id: new ObjectId(id) },
          { 
            $set: { 
              status: status || 'Resolved', 
              updatedAt: new Date() 
            } 
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ success: false, message: "Report not found" });
        }

        res.status(200).send({ 
          success: true, 
          message: "Report status updated successfully" 
        });

      } catch (error) {
        console.error("Error updating report status:", error);
        res.status(500).send({ 
          success: false, 
          message: "Failed to update report status",
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

    // --- GET ADMIN PLATFORM STATS ---
    app.get('/api/admin/stats', async (req, res) => {
      try {
        const usersCollection = db.collection("user");
        const reportsCollection = db.collection("reports");

        const totalUsers = await usersCollection.countDocuments();
        const totalLessons = await lessonsCollection.countDocuments();
        const activeSubscriptions = await usersCollection.countDocuments({
          $or: [
            { plan: "premium" },
            { role: "admin" }
          ]
        });
        
        const reportedLessons = await reportsCollection.countDocuments({ status: { $ne: "Resolved" } });

        res.status(200).send({
          success: true,
          totalUsers,
          totalLessons,
          activeSubscriptions,
          reportedLessons
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