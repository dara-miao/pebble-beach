import courseJson from "./pebble-beach.json";
import { OPENING_HOLE } from "./geom";
import { repairCourse } from "./repair";
import type { CourseData } from "./types";

let cached: CourseData | null = null;

/** Repaired Pebble Beach card — same object the renderer and the sim play. */
export function loadCourse(): CourseData {
  if (!cached) cached = repairCourse(courseJson as unknown as CourseData);
  return cached;
}

export { OPENING_HOLE };
