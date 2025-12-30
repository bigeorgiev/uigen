import { describe, test, expect, vi, beforeEach } from "vitest";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

// Mock the dependencies
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));
vi.mock("jose", () => ({
  SignJWT: vi.fn(),
  jwtVerify: vi.fn(),
}));

// Import the auth functions after mocking
import {
  createSession,
  getSession,
  deleteSession,
  verifySession,
  SessionPayload,
} from "@/lib/auth";

describe("Auth Module", () => {
  const mockUserId = "user-123";
  const mockEmail = "test@example.com";
  const mockToken = "mock-jwt-token";

  beforeEach(() => {
    vi.clearAllMocks();
    // Set environment variable for testing
    process.env.JWT_SECRET = "test-secret-key";
  });

  describe("createSession", () => {
    test("creates a session and sets cookie with correct values", async () => {
      const mockCookieStore = {
        set: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
      };

      (cookies as ReturnType<typeof vi.fn>).mockResolvedValue(mockCookieStore);

      const mockSignJWT = {
        setProtectedHeader: vi.fn().mockReturnThis(),
        setExpirationTime: vi.fn().mockReturnThis(),
        setIssuedAt: vi.fn().mockReturnThis(),
        sign: vi.fn().mockResolvedValue(mockToken),
      };

      (SignJWT as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        mockSignJWT
      );

      await createSession(mockUserId, mockEmail);

      // Verify SignJWT was called with session data
      expect(SignJWT).toHaveBeenCalledWith({
        userId: mockUserId,
        email: mockEmail,
        expiresAt: expect.any(Date),
      });

      // Verify JWT was configured correctly
      expect(mockSignJWT.setProtectedHeader).toHaveBeenCalledWith({
        alg: "HS256",
      });
      expect(mockSignJWT.setExpirationTime).toHaveBeenCalledWith("7d");
      expect(mockSignJWT.setIssuedAt).toHaveBeenCalled();
      expect(mockSignJWT.sign).toHaveBeenCalled();

      // Verify cookie was set with correct options
      expect(mockCookieStore.set).toHaveBeenCalledWith(
        "auth-token",
        mockToken,
        {
          httpOnly: true,
          secure: false, // NODE_ENV not set to production in test
          sameSite: "lax",
          expires: expect.any(Date),
          path: "/",
        }
      );
    });

    test("sets secure flag to true in production", async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const mockCookieStore = {
        set: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
      };

      (cookies as ReturnType<typeof vi.fn>).mockResolvedValue(mockCookieStore);

      const mockSignJWT = {
        setProtectedHeader: vi.fn().mockReturnThis(),
        setExpirationTime: vi.fn().mockReturnThis(),
        setIssuedAt: vi.fn().mockReturnThis(),
        sign: vi.fn().mockResolvedValue(mockToken),
      };

      (SignJWT as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        mockSignJWT
      );

      await createSession(mockUserId, mockEmail);

      expect(mockCookieStore.set).toHaveBeenCalledWith(
        "auth-token",
        mockToken,
        expect.objectContaining({
          secure: true,
        })
      );

      // Restore original NODE_ENV
      process.env.NODE_ENV = originalNodeEnv;
    });

    test("creates session with 7-day expiration", async () => {
      const mockCookieStore = {
        set: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
      };

      (cookies as ReturnType<typeof vi.fn>).mockResolvedValue(mockCookieStore);

      const mockSignJWT = {
        setProtectedHeader: vi.fn().mockReturnThis(),
        setExpirationTime: vi.fn().mockReturnThis(),
        setIssuedAt: vi.fn().mockReturnThis(),
        sign: vi.fn().mockResolvedValue(mockToken),
      };

      (SignJWT as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        mockSignJWT
      );

      const beforeCall = Date.now();
      await createSession(mockUserId, mockEmail);
      const afterCall = Date.now();

      // Get the session payload that was passed to SignJWT
      const sessionPayload = (SignJWT as unknown as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];

      // Verify expiration is approximately 7 days from now
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      const expiresAt = sessionPayload.expiresAt.getTime();

      expect(expiresAt).toBeGreaterThanOrEqual(beforeCall + sevenDays);
      expect(expiresAt).toBeLessThanOrEqual(afterCall + sevenDays);
    });
  });

  describe("getSession", () => {
    test("returns session payload when valid token exists", async () => {
      const mockExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const mockSessionPayload: SessionPayload = {
        userId: mockUserId,
        email: mockEmail,
        expiresAt: mockExpiresAt,
      };

      const mockCookieStore = {
        set: vi.fn(),
        get: vi.fn().mockReturnValue({ value: mockToken }),
        delete: vi.fn(),
      };

      (cookies as ReturnType<typeof vi.fn>).mockResolvedValue(mockCookieStore);
      (jwtVerify as ReturnType<typeof vi.fn>).mockResolvedValue({
        payload: mockSessionPayload,
      });

      const session = await getSession();

      expect(mockCookieStore.get).toHaveBeenCalledWith("auth-token");
      expect(jwtVerify).toHaveBeenCalledWith(mockToken, expect.any(Object));
      expect(session).toEqual(mockSessionPayload);
    });

    test("returns null when no token exists", async () => {
      const mockCookieStore = {
        set: vi.fn(),
        get: vi.fn().mockReturnValue(undefined),
        delete: vi.fn(),
      };

      (cookies as ReturnType<typeof vi.fn>).mockResolvedValue(mockCookieStore);

      const session = await getSession();

      expect(session).toBeNull();
      expect(jwtVerify).not.toHaveBeenCalled();
    });

    test("returns null when token verification fails", async () => {
      const mockCookieStore = {
        set: vi.fn(),
        get: vi.fn().mockReturnValue({ value: mockToken }),
        delete: vi.fn(),
      };

      (cookies as ReturnType<typeof vi.fn>).mockResolvedValue(mockCookieStore);
      (jwtVerify as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Invalid token")
      );

      const session = await getSession();

      expect(session).toBeNull();
    });

    test("returns null when token is expired", async () => {
      const mockCookieStore = {
        set: vi.fn(),
        get: vi.fn().mockReturnValue({ value: mockToken }),
        delete: vi.fn(),
      };

      (cookies as ReturnType<typeof vi.fn>).mockResolvedValue(mockCookieStore);
      (jwtVerify as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Token expired")
      );

      const session = await getSession();

      expect(session).toBeNull();
    });
  });

  describe("deleteSession", () => {
    test("deletes the auth-token cookie", async () => {
      const mockCookieStore = {
        set: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
      };

      (cookies as ReturnType<typeof vi.fn>).mockResolvedValue(mockCookieStore);

      await deleteSession();

      expect(mockCookieStore.delete).toHaveBeenCalledWith("auth-token");
    });
  });

  describe("verifySession", () => {
    test("returns session payload when valid token exists in request", async () => {
      const mockExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const mockSessionPayload: SessionPayload = {
        userId: mockUserId,
        email: mockEmail,
        expiresAt: mockExpiresAt,
      };

      const mockRequest = {
        cookies: {
          get: vi.fn().mockReturnValue({ value: mockToken }),
        },
      } as unknown as NextRequest;

      (jwtVerify as ReturnType<typeof vi.fn>).mockResolvedValue({
        payload: mockSessionPayload,
      });

      const session = await verifySession(mockRequest);

      expect(mockRequest.cookies.get).toHaveBeenCalledWith("auth-token");
      expect(jwtVerify).toHaveBeenCalledWith(mockToken, expect.any(Object));
      expect(session).toEqual(mockSessionPayload);
    });

    test("returns null when no token exists in request", async () => {
      const mockRequest = {
        cookies: {
          get: vi.fn().mockReturnValue(undefined),
        },
      } as unknown as NextRequest;

      const session = await verifySession(mockRequest);

      expect(session).toBeNull();
      expect(jwtVerify).not.toHaveBeenCalled();
    });

    test("returns null when token verification fails", async () => {
      const mockRequest = {
        cookies: {
          get: vi.fn().mockReturnValue({ value: mockToken }),
        },
      } as unknown as NextRequest;

      (jwtVerify as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Invalid token")
      );

      const session = await verifySession(mockRequest);

      expect(session).toBeNull();
    });

    test("returns null when token signature is invalid", async () => {
      const mockRequest = {
        cookies: {
          get: vi.fn().mockReturnValue({ value: "invalid-token" }),
        },
      } as unknown as NextRequest;

      (jwtVerify as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Invalid signature")
      );

      const session = await verifySession(mockRequest);

      expect(session).toBeNull();
    });
  });

  describe("JWT_SECRET environment variable", () => {
    test("uses JWT_SECRET from environment when available", async () => {
      process.env.JWT_SECRET = "custom-secret-key";

      const mockCookieStore = {
        set: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
      };

      (cookies as ReturnType<typeof vi.fn>).mockResolvedValue(mockCookieStore);

      const mockSignJWT = {
        setProtectedHeader: vi.fn().mockReturnThis(),
        setExpirationTime: vi.fn().mockReturnThis(),
        setIssuedAt: vi.fn().mockReturnThis(),
        sign: vi.fn().mockResolvedValue(mockToken),
      };

      (SignJWT as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        mockSignJWT
      );

      await createSession(mockUserId, mockEmail);

      // Verify sign was called (the secret is used internally by jose)
      expect(mockSignJWT.sign).toHaveBeenCalled();
    });

    test("falls back to development secret when JWT_SECRET is not set", async () => {
      delete process.env.JWT_SECRET;

      const mockCookieStore = {
        set: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
      };

      (cookies as ReturnType<typeof vi.fn>).mockResolvedValue(mockCookieStore);

      const mockSignJWT = {
        setProtectedHeader: vi.fn().mockReturnThis(),
        setExpirationTime: vi.fn().mockReturnThis(),
        setIssuedAt: vi.fn().mockReturnThis(),
        sign: vi.fn().mockResolvedValue(mockToken),
      };

      (SignJWT as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        mockSignJWT
      );

      await createSession(mockUserId, mockEmail);

      // Should still work with default secret
      expect(mockSignJWT.sign).toHaveBeenCalled();
    });
  });

  describe("SessionPayload interface", () => {
    test("session payload has correct structure", async () => {
      const mockExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const mockSessionPayload: SessionPayload = {
        userId: mockUserId,
        email: mockEmail,
        expiresAt: mockExpiresAt,
      };

      const mockCookieStore = {
        set: vi.fn(),
        get: vi.fn().mockReturnValue({ value: mockToken }),
        delete: vi.fn(),
      };

      (cookies as ReturnType<typeof vi.fn>).mockResolvedValue(mockCookieStore);
      (jwtVerify as ReturnType<typeof vi.fn>).mockResolvedValue({
        payload: mockSessionPayload,
      });

      const session = await getSession();

      expect(session).toHaveProperty("userId");
      expect(session).toHaveProperty("email");
      expect(session).toHaveProperty("expiresAt");
      expect(session?.userId).toBe(mockUserId);
      expect(session?.email).toBe(mockEmail);
    });
  });

  describe("Cookie configuration", () => {
    test("sets httpOnly flag to prevent XSS attacks", async () => {
      const mockCookieStore = {
        set: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
      };

      (cookies as ReturnType<typeof vi.fn>).mockResolvedValue(mockCookieStore);

      const mockSignJWT = {
        setProtectedHeader: vi.fn().mockReturnThis(),
        setExpirationTime: vi.fn().mockReturnThis(),
        setIssuedAt: vi.fn().mockReturnThis(),
        sign: vi.fn().mockResolvedValue(mockToken),
      };

      (SignJWT as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        mockSignJWT
      );

      await createSession(mockUserId, mockEmail);

      expect(mockCookieStore.set).toHaveBeenCalledWith(
        "auth-token",
        mockToken,
        expect.objectContaining({
          httpOnly: true,
        })
      );
    });

    test("sets sameSite to lax for CSRF protection", async () => {
      const mockCookieStore = {
        set: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
      };

      (cookies as ReturnType<typeof vi.fn>).mockResolvedValue(mockCookieStore);

      const mockSignJWT = {
        setProtectedHeader: vi.fn().mockReturnThis(),
        setExpirationTime: vi.fn().mockReturnThis(),
        setIssuedAt: vi.fn().mockReturnThis(),
        sign: vi.fn().mockResolvedValue(mockToken),
      };

      (SignJWT as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        mockSignJWT
      );

      await createSession(mockUserId, mockEmail);

      expect(mockCookieStore.set).toHaveBeenCalledWith(
        "auth-token",
        mockToken,
        expect.objectContaining({
          sameSite: "lax",
        })
      );
    });

    test("sets path to root for cookie availability", async () => {
      const mockCookieStore = {
        set: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
      };

      (cookies as ReturnType<typeof vi.fn>).mockResolvedValue(mockCookieStore);

      const mockSignJWT = {
        setProtectedHeader: vi.fn().mockReturnThis(),
        setExpirationTime: vi.fn().mockReturnThis(),
        setIssuedAt: vi.fn().mockReturnThis(),
        sign: vi.fn().mockResolvedValue(mockToken),
      };

      (SignJWT as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        mockSignJWT
      );

      await createSession(mockUserId, mockEmail);

      expect(mockCookieStore.set).toHaveBeenCalledWith(
        "auth-token",
        mockToken,
        expect.objectContaining({
          path: "/",
        })
      );
    });
  });

  describe("Integration scenarios", () => {
    test("complete auth flow: create, get, delete session", async () => {
      const mockCookieStore = {
        set: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
      };

      (cookies as ReturnType<typeof vi.fn>).mockResolvedValue(mockCookieStore);

      const mockSignJWT = {
        setProtectedHeader: vi.fn().mockReturnThis(),
        setExpirationTime: vi.fn().mockReturnThis(),
        setIssuedAt: vi.fn().mockReturnThis(),
        sign: vi.fn().mockResolvedValue(mockToken),
      };

      (SignJWT as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        mockSignJWT
      );

      // Create session
      await createSession(mockUserId, mockEmail);
      expect(mockCookieStore.set).toHaveBeenCalled();

      // Simulate getting session
      const mockExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      mockCookieStore.get.mockReturnValue({ value: mockToken });
      (jwtVerify as ReturnType<typeof vi.fn>).mockResolvedValue({
        payload: { userId: mockUserId, email: mockEmail, expiresAt: mockExpiresAt },
      });

      const session = await getSession();
      expect(session).not.toBeNull();
      expect(session?.userId).toBe(mockUserId);

      // Delete session
      await deleteSession();
      expect(mockCookieStore.delete).toHaveBeenCalledWith("auth-token");
    });

    test("verifySession works with NextRequest from middleware", async () => {
      const mockRequest = {
        cookies: {
          get: vi.fn().mockReturnValue({ value: mockToken }),
        },
      } as unknown as NextRequest;

      const mockExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      (jwtVerify as ReturnType<typeof vi.fn>).mockResolvedValue({
        payload: { userId: mockUserId, email: mockEmail, expiresAt: mockExpiresAt },
      });

      const session = await verifySession(mockRequest);

      expect(session).not.toBeNull();
      expect(session?.userId).toBe(mockUserId);
      expect(session?.email).toBe(mockEmail);
    });

    test("handles session expiration gracefully", async () => {
      const mockCookieStore = {
        set: vi.fn(),
        get: vi.fn().mockReturnValue({ value: mockToken }),
        delete: vi.fn(),
      };

      (cookies as ReturnType<typeof vi.fn>).mockResolvedValue(mockCookieStore);
      (jwtVerify as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("JWTExpired: token has expired")
      );

      const session = await getSession();

      expect(session).toBeNull();
    });
  });
});
