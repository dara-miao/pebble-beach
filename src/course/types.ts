export type Vec2 = [number, number];

export interface PolygonFeature {
  polygon: Vec2[];
  center: Vec2;
  ref?: string;
}

export interface BunkerFeature extends PolygonFeature {
  side: "left" | "right" | "center";
  yardsFromTee: number;
  yardsToGreen: number;
}

export interface HoleData {
  number: number;
  par: number;
  handicap: number;
  note: string;
  yards: Record<string, number>;
  path: Vec2[];
  osmPathYards: number;
  tee: Vec2;
  greenCenter: Vec2;
  pin: Vec2;
  green: PolygonFeature | null;
  tees: PolygonFeature[];
  fairways: PolygonFeature[];
  bunkers: BunkerFeature[];
}

export interface ElevationGrid {
  originX: number;
  originZ: number;
  stepX: number;
  stepZ: number;
  width: number;
  height: number;
  heightsYards: number[][];
  source?: string;
}

export interface CourseData {
  name: string;
  location: string;
  origin: { lat: number; lon: number; note: string };
  units: string;
  par: number;
  scorecard: Record<
    string,
    { name: string; total: number; rating?: number; slope?: number; holes: number[] }
  >;
  holes: HoleData[];
  unassignedBunkers: PolygonFeature[];
  rough: { polygon: Vec2[] }[];
  cartpaths: Vec2[][];
  coastline: Vec2[][];
  water: Vec2[][];
  woods: Vec2[][];
  trees: Vec2[];
  elevation: ElevationGrid;
  source: string;
}

export type TeeSet = "championship" | "blue" | "gold" | "white";
export type CameraMode = "address" | "tee" | "flyover" | "green" | "overview";

/** Back tees first — used when mapping scorecard sets onto physical boxes. */
export const TEE_SETS: TeeSet[] = ["championship", "blue", "gold", "white"];
