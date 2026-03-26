import "dotenv/config";

const isRender = process.env.DATABASE_URL?.includes("render.com");

export const DB_CONFIG = {
  connectionString: process.env.DATABASE_URL,
  ssl: isRender ? { rejectUnauthorized: false } : false,
};

export const PORT = process.env.PORT || 3000;
