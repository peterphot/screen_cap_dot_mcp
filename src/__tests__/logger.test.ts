import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import logger from "../util/logger.js";

describe("logger", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stderrSpy: any;

  beforeEach(() => {
    logger.resetLogLevel();
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  describe("setLogLevel / getLogLevel / resetLogLevel", () => {
    it("defaults to info", () => {
      expect(logger.getLogLevel()).toBe("info");
    });

    it("changes the log level", () => {
      logger.setLogLevel("debug");
      expect(logger.getLogLevel()).toBe("debug");
    });

    it("resets to info", () => {
      logger.setLogLevel("error");
      logger.resetLogLevel();
      expect(logger.getLogLevel()).toBe("info");
    });
  });

  describe("level filtering", () => {
    it("suppresses debug when level is info", () => {
      logger.setLogLevel("info");
      logger.debug("hidden");
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it("logs info when level is info", () => {
      logger.info("visible");
      expect(stderrSpy).toHaveBeenCalledOnce();
    });

    it("logs warn when level is info", () => {
      logger.warn("visible");
      expect(stderrSpy).toHaveBeenCalledOnce();
    });

    it("logs error when level is info", () => {
      logger.error("visible");
      expect(stderrSpy).toHaveBeenCalledOnce();
    });

    it("logs debug when level is debug", () => {
      logger.setLogLevel("debug");
      logger.debug("visible");
      expect(stderrSpy).toHaveBeenCalledOnce();
    });

    it("suppresses info and warn when level is error", () => {
      logger.setLogLevel("error");
      logger.info("hidden");
      logger.warn("hidden");
      expect(stderrSpy).not.toHaveBeenCalled();
      logger.error("visible");
      expect(stderrSpy).toHaveBeenCalledOnce();
    });
  });

  describe("output format", () => {
    it("writes to stderr with [timestamp] [LEVEL] message format", () => {
      logger.info("hello world");
      expect(stderrSpy).toHaveBeenCalledOnce();
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toMatch(
        /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] hello world\n$/
      );
    });

    it("uses correct level labels", () => {
      logger.setLogLevel("debug");

      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");

      const calls = stderrSpy.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(calls[0]).toContain("[DEBUG]");
      expect(calls[1]).toContain("[INFO]");
      expect(calls[2]).toContain("[WARN]");
      expect(calls[3]).toContain("[ERROR]");
    });

    it("includes the message content", () => {
      logger.warn("something went wrong");
      const output = stderrSpy.mock.calls[0][0] as string;
      expect(output).toContain("something went wrong");
    });
  });
});
