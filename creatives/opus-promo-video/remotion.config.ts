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
// Tag and convert as BT.709 limited range; JPEG frames otherwise produce
// full-range yuvj420p, which some players show washed out.
Config.setColorSpace("bt709");
Config.setCrf(18);
