/**
 * Remotion CLI config for the Changuito promo.
 *
 * These options apply to `npx remotion studio|render|still`. When rendering
 * through the Node.js APIs, pass them explicitly instead.
 *
 * All options: https://remotion.dev/docs/config
 */

import { Config } from "@remotion/cli/config";

Config.setRspack(true);
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
Config.setOverwriteOutput(true);
Config.setCodec("h264");
Config.setPixelFormat("yuv420p");
Config.setCrf(18);
