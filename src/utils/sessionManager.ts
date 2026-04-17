/**
 * Session Management Utility
 *
 * Handles session validation, refresh, and expiration for both staff and patient portals
 * Implements automatic session refresh, activity tracking, and user-friendly warnings
 */

import { supabase } from "@/lib/supabase";
import * as logger from "@/lib/logger";

export interface SessionConfig {
  duration: number; // in hours
  idleTimeout: number; // in minutes
  warningBeforeExpiry: number; // in minutes
  maxDuration: number; // maximum absolute duration in hours
}

export interface SessionInfo {
  expiresAt: Date;
  lastActivity: Date;
  isActive: boolean;
  timeRemaining: number; // in seconds
}

// Session configurations for different user types
export const SESSION_CONFIGS = {
  staff: {
    duration: 12, // 12 hours
    idleTimeout: 30, // 30 minutes
    warningBeforeExpiry: 5, // 5 minutes
    maxDuration: 24, // 24 hours absolute maximum
  } as SessionConfig,
  patient: {
    duration: 4, // 4 hours
    idleTimeout: 30, // 30 minutes
    warningBeforeExpiry: 5, // 5 minutes
    maxDuration: 8, // 8 hours absolute maximum
  } as SessionConfig,
};

const STORAGE_KEY_PREFIX = "mbhr_session_";
const ACTIVITY_CHECK_INTERVAL = 60 * 1000; // Check every minute
const REFRESH_BEFORE_EXPIRY = 15 * 60 * 1000; // Refresh 15 minutes before expiry

/**
 * Session Manager Class
 * Handles all session-related operations for a specific user type
 */
export class SessionManager {
  private userType: "staff" | "patient";
  private config: SessionConfig;
  private activityCheckInterval: NodeJS.Timeout | null = null;
  private lastActivityTime: number = Date.now();
  private sessionCreatedAt: number = Date.now();
  private onWarningCallback?: (timeRemaining: number) => void;
  private onExpireCallback?: () => void;

  constructor(
    userType: "staff" | "patient",
    onWarning?: (timeRemaining: number) => void,
    onExpire?: () => void,
  ) {
    this.userType = userType;
    this.config = SESSION_CONFIGS[userType];
    this.onWarningCallback = onWarning;
    this.onExpireCallback = onExpire;

    // Load saved session times
    this.loadSessionTimes();

    // Set up activity listeners
    this.setupActivityListeners();

    // Start periodic checks
    this.startActivityCheck();
  }

  private loadSessionTimes() {
    const savedActivity = localStorage.getItem(
      `${STORAGE_KEY_PREFIX}last_activity`,
    );
    const savedCreation = localStorage.getItem(
      `${STORAGE_KEY_PREFIX}created_at`,
    );

    if (savedActivity) {
      this.lastActivityTime = parseInt(savedActivity, 10);
    }

    if (savedCreation) {
      this.sessionCreatedAt = parseInt(savedCreation, 10);
    } else {
      // First time - save creation time
      this.sessionCreatedAt = Date.now();
      localStorage.setItem(
        `${STORAGE_KEY_PREFIX}created_at`,
        this.sessionCreatedAt.toString(),
      );
    }
  }

  private setupActivityListeners() {
    const events = ["mousedown", "keydown", "scroll", "touchstart", "click"];
    events.forEach((event) => {
      window.addEventListener(event, this.handleActivity.bind(this), {
        passive: true,
      });
    });
  }

  private handleActivity() {
    this.lastActivityTime = Date.now();
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}last_activity`,
      this.lastActivityTime.toString(),
    );
  }

  private startActivityCheck() {
    this.activityCheckInterval = setInterval(() => {
      this.checkSessionStatus();
    }, ACTIVITY_CHECK_INTERVAL);
  }

  private checkSessionStatus() {
    const now = Date.now();
    const timeSinceActivity = now - this.lastActivityTime;
    const timeSinceCreation = now - this.sessionCreatedAt;

    // Check absolute maximum duration
    const maxDurationMs = this.config.maxDuration * 60 * 60 * 1000;
    if (timeSinceCreation >= maxDurationMs) {
      logger.info(
        `[SessionManager] Maximum session duration reached for ${this.userType}`,
      );
      this.handleSessionExpiry();
      return;
    }

    // Check idle timeout
    const idleTimeoutMs = this.config.idleTimeout * 60 * 1000;
    if (timeSinceActivity >= idleTimeoutMs) {
      logger.info(`[SessionManager] Idle timeout reached for ${this.userType}`);
      this.handleSessionExpiry();
      return;
    }

    // Check if we should show warning
    const timeUntilIdleExpiry = idleTimeoutMs - timeSinceActivity;
    const warningThreshold = this.config.warningBeforeExpiry * 60 * 1000;

    if (timeUntilIdleExpiry <= warningThreshold && timeUntilIdleExpiry > 0) {
      const secondsRemaining = Math.floor(timeUntilIdleExpiry / 1000);
      if (this.onWarningCallback) {
        this.onWarningCallback(secondsRemaining);
      }
    }
  }

  private handleSessionExpiry() {
    this.cleanup();
    if (this.onExpireCallback) {
      this.onExpireCallback();
    }
  }

  /**
   * Get current session information
   */
  getSessionInfo(): SessionInfo {
    const now = Date.now();
    const timeSinceActivity = now - this.lastActivityTime;
    const timeSinceCreation = now - this.sessionCreatedAt;

    const idleTimeoutMs = this.config.idleTimeout * 60 * 1000;
    const maxDurationMs = this.config.maxDuration * 60 * 60 * 1000;

    const timeUntilIdleExpiry = idleTimeoutMs - timeSinceActivity;
    const timeUntilMaxExpiry = maxDurationMs - timeSinceCreation;

    const timeRemaining = Math.min(timeUntilIdleExpiry, timeUntilMaxExpiry);
    const expiresAt = new Date(now + timeRemaining);

    return {
      expiresAt,
      lastActivity: new Date(this.lastActivityTime),
      isActive: timeRemaining > 0,
      timeRemaining: Math.max(0, Math.floor(timeRemaining / 1000)),
    };
  }

  /**
   * Extend session by resetting activity timer
   */
  extendSession() {
    logger.info(`[SessionManager] Extending session for ${this.userType}`);
    this.lastActivityTime = Date.now();
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}last_activity`,
      this.lastActivityTime.toString(),
    );
  }

  /**
   * Reset session completely (on login)
   */
  resetSession() {
    logger.info(`[SessionManager] Resetting session for ${this.userType}`);
    this.sessionCreatedAt = Date.now();
    this.lastActivityTime = Date.now();
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}created_at`,
      this.sessionCreatedAt.toString(),
    );
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}last_activity`,
      this.lastActivityTime.toString(),
    );
  }

  /**
   * Clean up resources
   */
  cleanup() {
    logger.info(`[SessionManager] Cleaning up session for ${this.userType}`);
    if (this.activityCheckInterval) {
      clearInterval(this.activityCheckInterval);
      this.activityCheckInterval = null;
    }

    // Remove event listeners
    const events = ["mousedown", "keydown", "scroll", "touchstart", "click"];
    events.forEach((event) => {
      window.removeEventListener(event, this.handleActivity.bind(this));
    });

    // Clear storage
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}last_activity`);
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}created_at`);
  }

  /**
   * Destroy session manager
   */
  destroy() {
    this.cleanup();
  }
}

/**
 * Validate and refresh patient portal session
 */
export async function validateAndRefreshPatientSession(
  sessionToken: string,
): Promise<{ valid: boolean; needsRefresh: boolean; expiresAt?: Date }> {
  try {
    if (!supabase) {
      const { validateSession } = await import("@/services/patientPortalAuth");
      const user = await validateSession(sessionToken);
      if (!user) return { valid: false, needsRefresh: false };
      return {
        valid: true,
        needsRefresh: false,
        expiresAt: user.sessionExpiresAt ? new Date(user.sessionExpiresAt) : undefined,
      };
    }

    const { data: session, error } = await supabase
      .from("patient_portal_sessions")
      .select("id, expires_at, is_active, last_activity_at")
      .eq("session_token", sessionToken)
      .eq("is_active", true)
      .maybeSingle();

    if (error || !session) {
      return { valid: false, needsRefresh: false };
    }

    const expiresAt = new Date(session.expires_at);
    const now = new Date();
    const timeUntilExpiry = expiresAt.getTime() - now.getTime();

    // Grace period: 5 minutes after expiry
    const GRACE_PERIOD = 5 * 60 * 1000; // 5 minutes

    if (timeUntilExpiry < -GRACE_PERIOD) {
      // Session truly expired (beyond grace period)
      logger.info(
        "[SessionManager] Patient session expired beyond grace period",
      );
      await supabase
        .from("patient_portal_sessions")
        .update({ is_active: false })
        .eq("id", session.id);

      return { valid: false, needsRefresh: false };
    }

    // Check if session needs refresh (within 15 minutes of expiry OR within grace period)
    const needsRefresh = timeUntilExpiry < REFRESH_BEFORE_EXPIRY;

    if (needsRefresh || timeUntilExpiry < 0) {
      // Extend session
      const newExpiresAt = new Date(
        now.getTime() + SESSION_CONFIGS.patient.duration * 60 * 60 * 1000,
      );

      await supabase
        .from("patient_portal_sessions")
        .update({
          expires_at: newExpiresAt.toISOString(),
          last_activity_at: now.toISOString(),
        })
        .eq("id", session.id);

      logger.info("[SessionManager] Patient session refreshed", {
        wasExpired: timeUntilExpiry < 0,
        newExpiresAt,
      });

      return { valid: true, needsRefresh: true, expiresAt: newExpiresAt };
    }

    // Update last activity
    await supabase
      .from("patient_portal_sessions")
      .update({ last_activity_at: now.toISOString() })
      .eq("id", session.id);

    return { valid: true, needsRefresh: false, expiresAt };
  } catch (error) {
    logger.error("[SessionManager] Error validating patient session:", error);
    return { valid: false, needsRefresh: false };
  }
}

/**
 * Format time remaining for display
 */
export function formatTimeRemaining(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} second${seconds !== 1 ? "s" : ""}`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `${hours} hour${hours !== 1 ? "s" : ""}`;
  }

  return `${hours} hour${hours !== 1 ? "s" : ""} ${remainingMinutes} minute${remainingMinutes !== 1 ? "s" : ""}`;
}
