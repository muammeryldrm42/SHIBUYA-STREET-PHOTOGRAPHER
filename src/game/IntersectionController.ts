// Single source of truth for every signal at the scramble. All lamps, NPCs and vehicles read from here.

export type Phase =
  | "PED_GREEN" | "PED_WARNING" | "CLEARANCE"
  | "VEH_NS_GREEN" | "VEH_NS_YELLOW" | "ALL_RED_1"
  | "VEH_EW_GREEN" | "VEH_EW_YELLOW" | "ALL_RED_2";

export type Lamp = "green" | "yellow" | "red";

/**
 * Simulation timings in seconds. These are gameplay values, NOT measured timings of the real crossing.
 */
export const SIGNAL_CONFIG = {
  PED_GREEN: 30,
  PED_WARNING: 6,
  CLEARANCE_MIN: 3,
  CLEARANCE_MAX: 22, // hard stop so the cycle can never deadlock
  VEH_NS_GREEN: 13,
  VEH_NS_YELLOW: 3,
  ALL_RED_1: 2.5,
  VEH_EW_GREEN: 11,
  VEH_EW_YELLOW: 3,
  ALL_RED_2_MIN: 2.5,
  ALL_RED_2_MAX: 10,
};

const ORDER: Phase[] = ["PED_GREEN", "PED_WARNING", "CLEARANCE", "VEH_NS_GREEN", "VEH_NS_YELLOW", "ALL_RED_1", "VEH_EW_GREEN", "VEH_EW_YELLOW", "ALL_RED_2"];

export interface Occupancy { peopleOnCrossing: boolean; vehiclesInJunction: boolean }

export class IntersectionController {
  phase: Phase = "VEH_NS_GREEN";
  t = 0; // time spent in the current phase
  cycle = 0;
  private listeners: ((p: Phase, prev: Phase) => void)[] = [];

  onPhase(fn: (p: Phase, prev: Phase) => void) { this.listeners.push(fn); }

  /** Spec phase number 1–4 (vehicle sub-phases all belong to phase 4). */
  get mainPhase(): 1 | 2 | 3 | 4 {
    return this.phase === "PED_GREEN" ? 1 : this.phase === "PED_WARNING" ? 2 : this.phase === "CLEARANCE" ? 3 : 4;
  }
  get ped(): "green" | "flash" | "red" {
    return this.phase === "PED_GREEN" ? "green" : this.phase === "PED_WARNING" ? "flash" : "red";
  }
  get vehNS(): Lamp { return this.phase === "VEH_NS_GREEN" ? "green" : this.phase === "VEH_NS_YELLOW" ? "yellow" : "red"; }
  get vehEW(): Lamp { return this.phase === "VEH_EW_GREEN" ? "green" : this.phase === "VEH_EW_YELLOW" ? "yellow" : "red"; }
  vehFor(axis: "x" | "z"): Lamp { return axis === "z" ? this.vehNS : this.vehEW; }

  /** Seconds of walking time left (green + warning). 0 when pedestrians must not be on the road. */
  get pedTimeLeft(): number {
    if (this.phase === "PED_GREEN") return SIGNAL_CONFIG.PED_GREEN - this.t + SIGNAL_CONFIG.PED_WARNING;
    if (this.phase === "PED_WARNING") return SIGNAL_CONFIG.PED_WARNING - this.t;
    return 0;
  }
  /** Rough seconds until the next pedestrian green. */
  get timeToPedGreen(): number {
    if (this.phase === "PED_GREEN" || this.phase === "PED_WARNING") return 0;
    const c = SIGNAL_CONFIG;
    const rest: Record<Phase, number> = {
      PED_GREEN: 0, PED_WARNING: 0,
      CLEARANCE: c.CLEARANCE_MIN, VEH_NS_GREEN: c.VEH_NS_GREEN, VEH_NS_YELLOW: c.VEH_NS_YELLOW, ALL_RED_1: c.ALL_RED_1,
      VEH_EW_GREEN: c.VEH_EW_GREEN, VEH_EW_YELLOW: c.VEH_EW_YELLOW, ALL_RED_2: c.ALL_RED_2_MIN,
    };
    let s = Math.max(0, rest[this.phase] - this.t);
    for (let i = ORDER.indexOf(this.phase) + 1; i < ORDER.length; i++) s += rest[ORDER[i]];
    return s;
  }

  update(dt: number, occ: Occupancy) {
    this.t += dt;
    const c = SIGNAL_CONFIG;
    let done = false;
    switch (this.phase) {
      case "PED_GREEN": done = this.t >= c.PED_GREEN; break;
      case "PED_WARNING": done = this.t >= c.PED_WARNING; break;
      case "CLEARANCE":
        // Vehicles are only released once nobody is left on the crossing.
        done = (this.t >= c.CLEARANCE_MIN && !occ.peopleOnCrossing) || this.t >= c.CLEARANCE_MAX;
        break;
      case "VEH_NS_GREEN": done = this.t >= c.VEH_NS_GREEN; break;
      case "VEH_NS_YELLOW": done = this.t >= c.VEH_NS_YELLOW; break;
      case "ALL_RED_1": done = this.t >= c.ALL_RED_1 && (!occ.vehiclesInJunction || this.t >= 8); break;
      case "VEH_EW_GREEN": done = this.t >= c.VEH_EW_GREEN; break;
      case "VEH_EW_YELLOW": done = this.t >= c.VEH_EW_YELLOW; break;
      case "ALL_RED_2": done = (this.t >= c.ALL_RED_2_MIN && !occ.vehiclesInJunction) || this.t >= c.ALL_RED_2_MAX; break;
    }
    if (done) this.advance();
  }

  private advance() {
    const prev = this.phase;
    const i = (ORDER.indexOf(prev) + 1) % ORDER.length;
    this.phase = ORDER[i];
    this.t = 0;
    if (this.phase === "PED_GREEN") this.cycle++;
    this.validate();
    for (const l of this.listeners) l(this.phase, prev);
  }

  /** Conflicting greens are a bug, never a state: fail loudly. */
  validate() {
    const pedGo = this.ped !== "red";
    const ns = this.vehNS !== "red", ew = this.vehEW !== "red";
    if ((pedGo && (ns || ew)) || (ns && ew)) throw new Error(`Conflicting signals in phase ${this.phase}`);
  }

  label(): string {
    switch (this.mainPhase) {
      case 1: return "WALK";
      case 2: return "HURRY";
      case 3: return "CLEAR";
      default: return "WAIT";
    }
  }
}
