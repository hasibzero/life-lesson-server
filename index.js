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
      "Pinged your deployment. You successfully connected to MongoDB!",
    );

    // 2. Define API Routes
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
    // <-- Properly closed the API route

    app.get("/api/my-lessons/:creatorId", async (req, res) => {
      try {
        const { creatorId } = req.params;

        if (!creatorId) {
          return res
            .status(400)
            .send({ success: false, message: "Creator ID is required" });
        }

        // Find all lessons where the creatorId matches the requesting user
        // Sort by createdAt descending (-1) so the newest lessons show first
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

    




  } catch (error) {
    console.error("Failed to connect to MongoDB", error);
  }
  // FIX: Removed `finally { client.close() }` so the database stays open to listen for requests!
}

run().catch(console.dir);

// 3. Base Route & Server Listener
app.get("/", (req, res) => {
  res.send("Digital Life Lessons API is running!");
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
