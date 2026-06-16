const express = require('express');
const cors = require('cors');
const { ApolloServer } = require('@apollo/server');
const { expressMiddleware } = require('@apollo/server/express4');
const { readFileSync } = require('fs');
const path = require('path');
const { mergeTypeDefs, mergeResolvers } = require('@graphql-tools/merge');
const bcrypt = require('bcryptjs');
const { sequelize, User } = require('./models');
const multer = require('multer');
const fs = require('fs');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Load all .graphql schema files
const bookTypeDefs = readFileSync(path.join(__dirname, 'schema', 'book.graphql'), 'utf-8');
const userTypeDefs = readFileSync(path.join(__dirname, 'schema', 'user.graphql'), 'utf-8');
const loanTypeDefs = readFileSync(path.join(__dirname, 'schema', 'loan.graphql'), 'utf-8');

// Load all resolvers
const bookResolver = require('./resolvers/bookResolver');
const userResolver = require('./resolvers/userResolver');
const loanResolver = require('./resolvers/loanResolver');

// Merge schemas and resolvers
const typeDefs = mergeTypeDefs([bookTypeDefs, userTypeDefs, loanTypeDefs]);
const resolvers = mergeResolvers([bookResolver, userResolver, loanResolver]);

async function startServer() {
  const app = express();

  // Create Apollo Server instance
  const server = new ApolloServer({
    typeDefs,
    resolvers,
    introspection: true,
  });

  // Start Apollo Server
  await server.start();

  // Serve static frontend files from client/
  app.use(cors());
  app.use(express.static(path.join(__dirname, './client')));

  // Catch-all: serve index.html for root path (client-side routing)
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, './client/index.html'));
  });

  // Apply middleware
  app.use(
    '/graphql',
    express.json(),
    expressMiddleware(server)
  );

  // Serve uploads folder statically
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

  // REST endpoint for file uploads
  app.post('/upload', cors(), upload.single('cover'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    // Return the URL relative to the server origin (or absolute)
    // Here we return the absolute URL pointing to this backend server
    const host = req.get('host');
    const protocol = req.protocol;
    const fileUrl = `${protocol}://${host}/uploads/${req.file.filename}`;
    
    res.json({ url: fileUrl });
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Connect to database and sync models
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');

    await sequelize.sync({ alter: true });
    console.log('✅ Database models synchronized.');

    // ── Seed Admin Account ──────────────────────────────────
    const adminExists = await User.findOne({ where: { email: 'admin@library.com' } });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await User.create({
        name: 'Administrator',
        email: 'admin@library.com',
        password: hashedPassword,
        role: 'admin',
        phone: null,
      });
      console.log('✅ Admin account created (admin@library.com / admin123)');
    }
  } catch (error) {
    console.error('❌ Unable to connect to the database:', error.message);
    process.exit(1);
  }

  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}/graphql`);
  });
}

startServer().catch((error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
