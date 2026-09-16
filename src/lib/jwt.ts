import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";

export interface JWTPayload {
  userId: number;
  email: string;
  role: string;
  companyId?: number;
}

export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET) as JWTPayload;
    return decoded;
  } catch (error: any) {
    if (error.name === "TokenExpiredError") {
      // Token has expired
      return null;
    }
    // Any other JWT verification error
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  try {
    jwt.verify(token, SECRET);
    return false;
  } catch (error: any) {
    if (error.name === "TokenExpiredError") {
      return true;
    }
    return false;
  }
}
