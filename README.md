# ⚡ Life Lessons Server — Express.js Backend API

The Life Lessons Server is a robust **Node.js & Express.js** REST API that powers the Digital Life Lessons platform. It connects with **MongoDB Atlas**, verifies secure session tokens via **JWKS (RS256)** issued by the frontend's Better Auth system, and exposes optimized endpoints for managing life lessons, user interactions, bookmarks, comments, reports, and full admin operations.

---

## 🌐 Live URL

- **Server API**: [https://life-lessons-server.vercel.app](https://life-lessons-server.vercel.app)
- **Frontend Client**: [https://digital-life-lessons.vercel.app](https://digital-life-lessons.vercel.app)

---

## ✨ Key Features

- 🔐 **JWT Authentication (JWKS RS256)** — Secure token verification using `jose-cjs` with remote JWKS endpoint integration from the frontend's Better Auth system.
- 📝 **Full Lesson CRUD** — Create, read, update, and delete lessons with admin auto-review, featured flag support, and cascade report resolution on deletion.
- ❤️ **Engagement System** — Toggle likes and bookmarks per user with atomic `$addToSet` / `$pull` MongoDB operations ensuring consistency.
- 💬 **Threaded Comments** — Post and fetch comments with aggregation pipeline `$lookup` to enrich responses with creator name and avatar.
- 🚨 **Report & Moderation** — Users can report lessons with reason/details; admins review, resolve, or dismiss reports with full audit trail.
- 🔍 **Advanced Search & Filtering** — Regex-powered full-text search across titles, descriptions, and author names with category, emotional tone, access level, and sort filters.
- 📊 **Admin Dashboard API** — Dedicated admin endpoints for platform stats, user management (role promotion/demotion, banning), lesson review pipeline, and report management.
- 👤 **User Profile System** — Public profile endpoints with authored lesson aggregation, bio, avatar, and social links support.
- 📄 **Pagination & Sorting** — Server-side pagination with configurable page size, skip-based cursors, and multi-field sort options (newest, oldest, popular).
- 🛡️ **CORS & Security** — Pre-configured CORS whitelist with credential support for secure cross-origin API access.

---

## 📦 NPM Packages Used

| Package | Purpose |
|---------|---------|
| **express** | Web framework for routing, middleware, and request handling |
| **mongodb** | Native MongoDB driver for database operations and aggregation |
| **dotenv** | Environment variable management from `.env` files |
| **jose-cjs** | JWT verification using remote JWKS (RS256) for secure auth |
| **cors** | Cross-origin resource sharing middleware |
| **nodemon** *(dev)* | Auto-restart server on file changes during development |

---

## 🚀 Getting Started

```bash
# Clone the repository
git clone https://github.com/hasibzero/life-lesson-server.git

# Install dependencies
npm install

# Create .env file with your credentials
# MONGODB_URI=your_mongodb_connection_string
# CLIENT_URL=your_frontend_url
# PORT=5000

# Start development server
npm run dev
```
