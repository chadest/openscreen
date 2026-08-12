/**
 * Keyframe animation types for OpenScreen.
 * Clip-anchored animations that can be applied to annotations, zooms, and camera fullscreen regions.
 */

export type KeyframeAnimationType =
	| "position" // Move annotation/zoom (x, y)
	| "scale" // Uniform scale
	| "rotation" // 2D rotation (degrees)
	| "opacity" // Fade in/out
	| "skew" // Skew transform
	| "blur" // Blur amount
	| "color-shift"; // Color change

export type EasingType =
	| "linear"
	| "ease-in"
	| "ease-out"
	| "ease-in-out"
	| "ease-out-bounce"
	| "ease-out-elastic"
	| "ease-out-back";

/** A single keyframe point in time */
export interface KeyframePoint {
	/** Offset in milliseconds from the start of the parent animation */
	timeOffsetMs: number;
	/** The animated value (number for most, string for colors) */
	value: number | number[] | string;
	/** Optional easing curve for interpolation to the next keyframe */
	easing?: EasingType;
}

/** A track of animation for a single property */
export interface AnimationPropertyTrack {
	/** Which property is being animated */
	property: KeyframeAnimationType;
	/** Array of keyframes, must be sorted by timeOffsetMs */
	keyframes: KeyframePoint[];
	/** Whether animation loops */
	loop?: boolean;
	/** How many times to loop (0 = infinite) */
	loopCount?: number;
	/** Ping-pong: play forward then backward */
	pingPong?: boolean;
}

/** Keyframe animation container (clip-anchored like zoom/annotation) */
export interface KeyframeAnimation {
	id: string;

	// Clip anchor (v5 model from timeline-model.md)
	clipId?: string;
	sourceStartSec?: number;
	sourceEndSec?: number;

	// Derived cache (re-derived on structural ops)
	startMs?: number;
	endMs?: number;

	// What to animate
	/** ID of the target region (annotation or zoom) */
	targetId: string;
	/** Type of target region */
	targetType: "annotation" | "zoom" | "camera-fullscreen";

	// Animation data
	/** Property tracks being animated */
	tracks: AnimationPropertyTrack[];

	/** Playback origin */
	origin: "system" | "agent" | "user";
	reason?: string;
}

// Easing function implementations
export function applyEasing(t: number, easing: EasingType): number {
	// Clamp t to [0, 1]
	t = Math.max(0, Math.min(1, t));

	switch (easing) {
		case "linear":
			return t;
		case "ease-in":
			return t * t;
		case "ease-out":
			return t * (2 - t);
		case "ease-in-out":
			return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
		case "ease-out-bounce": {
			const n1 = 7.5625;
			const d1 = 2.75;
			if (t < 1 / d1) {
				return n1 * t * t;
			} else if (t < 2 / d1) {
				return n1 * (t -= 1.5 / d1) * t + 0.75;
			} else if (t < 2.5 / d1) {
				return n1 * (t -= 2.25 / d1) * t + 0.9375;
			} else {
				return n1 * (t -= 2.625 / d1) * t + 0.984375;
			}
		}
		case "ease-out-elastic": {
			const c5 = (2 * Math.PI) / 4.5;
			return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c5) + 1;
		}
		case "ease-out-back": {
			const c1 = 1.70158;
			const c3 = c1 + 1;
			return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
		}
		default:
			return t;
	}
}

/** Interpolate between two values with easing */
export function interpolateValue(
	v1: number | string,
	v2: number | string,
	t: number,
	easing: EasingType = "linear",
): number | string {
	const easedT = applyEasing(t, easing);

	// String values (colors) - only support start/end, no lerp
	if (typeof v1 === "string" || typeof v2 === "string") {
		return easedT < 0.5 ? v1 : v2;
	}

	// Number values
	if (typeof v1 === "number" && typeof v2 === "number") {
		return v1 + (v2 - v1) * easedT;
	}

	// Array values (positions, etc.)
	if (Array.isArray(v1) && Array.isArray(v2)) {
		return v1.map((val, i) => val + ((v2[i] ?? val) - val) * easedT);
	}

	return v1;
}

/** Find the keyframe value at a given time offset */
export function evaluateKeyframeTrack(
	track: AnimationPropertyTrack,
	timeOffsetMs: number,
): number | number[] | string | null {
	if (track.keyframes.length === 0) return null;
	if (track.keyframes.length === 1) return track.keyframes[0].value;

	const { keyframes, loop, loopCount = 0, pingPong } = track;

	// Find animation duration
	const duration = keyframes[keyframes.length - 1].timeOffsetMs;

	// Handle looping
	let adjustedTime = timeOffsetMs;
	if (loop && duration > 0) {
		const cycleCount = Math.floor(timeOffsetMs / duration);
		adjustedTime = timeOffsetMs % duration;

		// If loopCount is set and we've exceeded it, clamp to end
		if (loopCount > 0 && cycleCount >= loopCount) {
			adjustedTime = duration;
		}

		// Ping-pong: alternate direction
		if (pingPong && Math.floor(timeOffsetMs / duration) % 2 === 1) {
			adjustedTime = duration - adjustedTime;
		}
	}

	// Clamp to duration
	adjustedTime = Math.min(adjustedTime, duration);

	// Find surrounding keyframes
	let startKf = keyframes[0];
	let endKf = keyframes[0];

	for (let i = 0; i < keyframes.length; i++) {
		if (keyframes[i].timeOffsetMs <= adjustedTime) {
			startKf = keyframes[i];
		}
		if (keyframes[i].timeOffsetMs >= adjustedTime) {
			endKf = keyframes[i];
			break;
		}
	}

	// If we're exactly at a keyframe or at the start
	if (startKf === endKf) {
		return startKf.value;
	}

	// Interpolate between keyframes
	const t =
		(adjustedTime - startKf.timeOffsetMs) /
		(endKf.timeOffsetMs - startKf.timeOffsetMs);
	const easing = startKf.easing ?? "linear";

	return interpolateValue(startKf.value, endKf.value, t, easing);
}
