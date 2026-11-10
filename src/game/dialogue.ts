// Pre-written dialogue pools. No external AI service is used.
import type { Archetype } from "./characters/CharacterFactory";

export const NAMES_F = ["Yui", "Hina", "Sakura", "Aoi", "Mio", "Rin", "Mei", "Akari", "Haruka", "Nanami", "Kaede", "Riko", "Saki", "Emi", "Noa", "Yuna", "Miku", "Chihiro", "Ayaka", "Koharu"];
export const NAMES_M = ["Haruto", "Ren", "Sota", "Yuto", "Kaito", "Riku", "Daiki", "Takumi", "Shun", "Kenta", "Hiro", "Yuki", "Ryo", "Naoki", "Itsuki", "Kazuki", "Tomo", "Shota", "Akira", "Jun"];
export const NAMES_TOURIST = ["Emma", "Lucas", "Sofia", "Noah", "Mia", "Leo", "Olivia", "Mateo", "Chloe", "Jonas", "Amara", "Diego", "Freya", "Omar", "Priya", "Elif", "Can", "Zeynep"];

export const ARCHE_TAG: Record<Archetype, string> = {
  fashion: "Street fashion", harajuku: "Harajuku style", tourist: "Tourist", student: "Student",
  business: "Office worker", influencer: "Influencer", casual: "Local", photographer: "Photographer",
};

export const ASK = [
  "Hey! I love your outfit. Can I take your photo?",
  "Excuse me — I'm shooting street portraits today. Could I photograph you?",
  "Hi! Your style really stands out. Mind if I take a picture?",
  "Sorry to bother you — would you be up for a quick portrait?",
  "That look is great against this crossing. May I take a shot?",
];

export const ACCEPT_EITHER = [
  "Sure! Let's do it. Walking or posing?",
  "Oh, why not! How do you want me?",
  "Haha, okay! Should I walk or stand still?",
  "A street portrait in Shibuya? I'm in. You choose.",
];
export const ACCEPT_WALK = [
  "Okay — but I'm in a hurry. Take the shot while I'm walking!",
  "Sure, catch me on the crossing. I won't stop though!",
  "Yes! A walking shot on the scramble would be so cool.",
];
export const ACCEPT_STATIC = [
  "Sure! Let me pose right here.",
  "Okay, but let's stay on the sidewalk. I'll pose for you.",
  "Yes! I've got a pose in mind already.",
];
export const DECLINE = [
  "Ah, sorry — not today.",
  "No thank you, I'm a bit shy.",
  "Sorry, I'm running late!",
  "I'd rather not. Good luck though!",
  "Sumimasen… no photos, please.",
];
export const DECLINE_REPLY = ["No problem — have a great day!", "Of course. Thanks anyway!", "All good, take care!"];

export const WALK_START_WAIT = ["I'll cross at the next green. Stay close!", "Wait for the walk signal with me — then shoot!", "Next green, I'm crossing. Be ready!"];
export const WALK_GO = ["Here we go — take the shot while I'm walking!", "Green! Follow me with the camera!", "Okay, crossing now. Catch me mid-stride!"];
export const LIGHT_CHANGING = ["Oh, the light is changing! Let's go!", "It's about to turn red — hurry!", "Light's ending! Run for the sidewalk!"];
export const WALK_RETRY = ["Missed it? I'm crossing back next green — try again!", "No shot? One more pass on the next signal!"];
export const WALK_GIVEUP = ["No worries — maybe next time!", "I have to run now. Good luck!"];

export const POSE_LINES: Record<string, string[]> = {
  peace: ["Peace sign? Classic!", "Piisu!"],
  smile: ["Just a natural smile, okay?"],
  pockets: ["Hands in pockets — cool, right?"],
  fixJacket: ["Let me fix my jacket…", "One second, adjusting my collar."],
  sideTurn: ["How about a side angle?", "I'll turn a little."],
  backTurn: ["Shoot me from behind — looking back!"],
  hipHand: ["Hand on the hip. Like a magazine!"],
  wave: ["Hello, camera!"],
  cheer: ["Yay! Shibuya!"],
  friend: ["Can my friend join the photo?", "Together! Come here!"],
};

export function reactLine(score: number): string {
  const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
  if (score >= 82) return pick(["Wow! That's a great shot!", "I love this angle!", "So cool — you're really good!", "This is going straight to my profile!"]);
  if (score >= 62) return pick(["Nice! I like it.", "That came out well!", "Pretty good — thank you!"]);
  if (score >= 40) return pick(["Hmm, not bad. Can we try another one?", "It's a little off — one more?", "Almost! Try again?"]);
  return pick(["Ah… it's blurry, isn't it? Can we try another one?", "I'm barely in the frame! One more?", "Hmm, let's try again."]);
}
export const WRAP = ["Thank you! That was fun.", "Arigatou! Bye-bye!", "Thanks — good luck with your photos!", "See you around Shibuya!"];
export const ALREADY = ["We already took our photo — thanks again!", "Haha, one shoot is enough for me today!"];
export const BUSY = ["Sorry, not right now!"];
export const TIMEOUT = ["I've got to get going — bye!", "Sorry, I can't wait any longer!"];
export const CHATTER = ["…and then we go to Center-Gai?", "The screen is huge!", "Sugoi…", "Which exit was it again?", "I'm so hungry.", "Wait for the green.", "So many people!", "Let's take the diagonal.", "Kawaii!", "My train is in ten minutes."];
