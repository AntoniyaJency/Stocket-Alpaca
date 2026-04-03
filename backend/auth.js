const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const JWT_SECRET = process.env.JWT_SECRET || "algotrade_dev_secret";
const JWT_EXPIRES = "24h";

// In-memory user store (replace with DB in production)
const users = new Map();

function register(email, password, name) {
  if (users.has(email)) throw new Error("Email already registered");
  const hash = bcrypt.hashSync(password, 10);
  const user = { id: Date.now().toString(), email, name, hash, createdAt: new Date().toISOString() };
  users.set(email, user);
  return signToken(user);
}

function login(email, password) {
  const user = users.get(email);
  if (!user) throw new Error("Invalid credentials");
  if (!bcrypt.compareSync(password, user.hash)) throw new Error("Invalid credentials");
  return signToken(user);
}

function signToken(user) {
  const payload = { id: user.id, email: user.email, name: user.name };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  return { token, user: payload };
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.user = verifyToken(auth.slice(7));
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = { register, login, authMiddleware };
