/**
 * Deterministic pseudo-randomness for the seed.
 *
 * The demonstration data has to look varied but be reproducible: `npm run
 * db:reset` must produce the same organization every time, or the verification
 * notes in docs/VERIFICATION.md would stop matching what is on screen.
 */

export class Rng {
  private state: number;

  constructor(seed: string) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    this.state = h >>> 0;
  }

  next(): number {
    this.state += 0x6d2b79f5;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(minInclusive: number, maxInclusive: number): number {
    return minInclusive + Math.floor(this.next() * (maxInclusive - minInclusive + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)] as T;
  }

  pickMany<T>(items: readonly T[], count: number): T[] {
    const pool = [...items];
    const out: T[] = [];
    for (let i = 0; i < count && pool.length > 0; i += 1) {
      out.push(pool.splice(Math.floor(this.next() * pool.length), 1)[0] as T);
    }
    return out;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}

/**
 * Performance profiles shape the ratings a generated review produces, so the
 * seeded rating distribution and 9-box report look like a real company rather
 * than everyone sitting on a 3.
 */
export type Profile = 'outstanding' | 'strong' | 'solid' | 'developing' | 'struggling';

export const PROFILE_WEIGHTS: Record<Profile, { centre: number; spread: number }> = {
  outstanding: { centre: 0.92, spread: 0.08 },
  strong: { centre: 0.78, spread: 0.12 },
  solid: { centre: 0.6, spread: 0.14 },
  developing: { centre: 0.42, spread: 0.14 },
  struggling: { centre: 0.26, spread: 0.12 },
};

/** Maps a profile onto a concrete rating within a scale's min..max. */
export function ratingFor(
  rng: Rng,
  profile: Profile,
  min: number,
  max: number,
  selfBias = 0,
): number {
  const { centre, spread } = PROFILE_WEIGHTS[profile];
  const jitter = (rng.next() - 0.5) * 2 * spread;
  const fraction = Math.min(Math.max(centre + jitter + selfBias, 0), 1);
  return Math.round(min + fraction * (max - min));
}

// ---------------------------------------------------------------------------
// Text banks for generated written answers.
// ---------------------------------------------------------------------------

export const SELF_PROUD = [
  'The Hillcrest kitchen remodel. We hit a surprise with the floor joists behind the old cabinets and I worked out the fix with the PM the same morning instead of stopping the job. We still handed over on the original date.',
  'Getting the Oakmont basement framed ahead of the inspection date. We had two days of rain and still made it because we pre-cut under cover.',
  'Training the two new apprentices. Both of them can set and plumb a wall on their own now, which they could not do in the spring.',
  'The Riverbend addition. It was the cleanest set of inspections I have been part of — no corrections on framing or rough-in.',
  'Rebuilding the punch process on my jobs. I now walk the house before the client does, and my punch lists have gone from two pages to about six items.',
  'Holding the schedule on the Thornton project after we lost a week to the cabinet supplier. I resequenced trim and paint so we did not lose the handover date.',
];

export const SELF_HARDEST = [
  'The stretch in July when we were two people short. I took on too much myself instead of asking for help earlier, and the paperwork slipped. I should have flagged it in the first week.',
  'A client on the Maple job who kept changing the tile layout. I should have pushed for a written change order on the first change instead of the third.',
  'Learning to delegate. I am quicker doing it myself, but that does not help the crew get better, and it makes me the bottleneck.',
  'The equipment breakdown in August cost us four days. I had not checked the service schedule, and that was mine to check.',
  'Getting used to the new estimating sheets. My first few takeoffs were low on labour and that showed up in the job costs.',
  'Giving direct feedback to someone more experienced than me. I avoided it for too long and the problem got bigger.',
];

export const MANAGER_SUMMARY_STRONG = [
  'A genuinely strong year. The work is clean, the inspections pass first time, and the crew works better when this person is on it. The standout was the Riverbend addition, which came in on schedule with a six-item punch list. Where to push next year: taking more of the client conversation directly rather than routing it through the PM.',
  'Dependable, safe and skilled — the person I put on a job when the client is going to be on site every day. Quality has been consistently above standard and there were no safety incidents on their crew. The growth area is planning further ahead; the current habit is to solve problems well on the day rather than see them coming a week out.',
  'An excellent year with real leadership growth. Took on the two new apprentices and both are now productive, which is a direct contribution to capacity. Still occasionally takes on work personally rather than assigning it; that is the main thing to work on.',
];

export const MANAGER_SUMMARY_SOLID = [
  'A solid year doing the job well. The work meets our standard, time sheets and logs are in on schedule, and the crew gets on with this person. Two things to focus on next year: flagging schedule slippage the same day rather than at the end of the week, and getting more confident reading the detail sheets without checking.',
  'Reliable and safe, with steady quality. The Maple job was a good example of handling a difficult client without it escalating. Where there is room: productivity on repetitive work is below where the experience level suggests it should be, and we talked about why in the Q3 check-in.',
  'Met the standard across the year. Strongest area is working with the rest of the crew — people ask for this person by name. The area to develop is change-order discipline; there were two occasions where out-of-scope work got built before it was written up.',
];

export const MANAGER_SUMMARY_DEVELOPING = [
  'A mixed year. The craft is coming along and safety has not been a concern. The real issue has been reliability on timing — eleven late starts over the year, which affects the whole crew, not just one person. We have agreed a specific plan for the first quarter and will review it at the next check-in. The improvement since September has been real and I want to acknowledge that.',
  'Progress in some areas and not in others. Quality of finish work has clearly improved since the spring. Documentation remains the weak point: daily logs are frequently missing, which causes problems at billing. This is the single thing to fix, and it is fixable.',
  'This year did not go the way either of us wanted. The skills are there — the Thornton trim work was some of the best on that job — but we have had the same conversation about change orders three times. I want to be straight that this needs to change, and I also want to be clear that I think it can.',
];

export const FOCUS_AREAS = [
  'Two things: get the daily log in before leaving site, and take the lead on one client walkthrough a month with me there.',
  'Step up into running a small crew on your own. Start with the two-day jobs and we will review after the first three.',
  'Get the layout and detail reading solid enough that you are not checking with me. Pair with Tyler on the next two framing jobs.',
  'Change orders. Nothing out of scope gets built before it is written up and priced. No exceptions this year.',
  'Finish the apprenticeship hours and get the competency sign-offs done by the end of Q2.',
  'Punch list discipline — walk the job yourself before the client does, every time.',
];

export const SUPPORT_NEEDED = [
  'A second impact driver so we are not sharing on the bigger jobs.',
  'Time on a job with Abebe to see how the finish crew sequences a remodel.',
  'The 30-hour safety course, if there is budget for it.',
  'Clearer plan sets. Half the problems come from conflicts between the architectural and structural sheets.',
  'Somebody to cover the yard when I am on site, so I am not doing both.',
  'Nothing I can think of — the tools and support are there.',
];

export const PEER_COPY = [
  'Runs a clean, calm site. Nobody is shouting and the work still gets done on time. I have taken the daily brief habit back to my own crew.',
  'Explains the why, not just the what. When an apprentice asks a question they get a real answer, which is why people learn fast on that crew.',
  'Never leaves a mess for the next trade. It sounds small but it saves us half a day on every job.',
  'Honest about problems early. I would rather hear bad news on Monday than find it on Friday, and that is what I get.',
];

export const PEER_CHANGE = [
  'Let the crew make more of the small calls. Right now everything routes back for a decision, which slows the day down.',
  'Share the schedule earlier. We often find out about a sequence change the morning of.',
  'Push back on the office when the dates are not realistic, instead of absorbing it and working longer.',
  'Write the handover notes down. The verbal handover is good but it does not survive a day off.',
];

export const CHECKIN_WENT_WELL = [
  'Got the Oakmont basement closed out with a short punch list. Client signed off without a second visit.',
  'The new apprentice is picking it up quickly and is now useful on layout.',
  'No safety issues and no equipment damage this quarter, which has not always been true.',
  'Caught a plan conflict before we framed it, which saved a rebuild.',
  'Hit every scheduled inspection date this quarter.',
];

export const CHECKIN_IN_WAY = [
  'Material deliveries. We have been waiting on trim twice this quarter and the crew had nothing to do for half a day each time.',
  'Short-staffed on Tuesdays and Wednesdays when the other crew pulls people.',
  'The plan sets on the Thornton job have had three revisions and we are not always getting the latest one.',
  'Too much time on paperwork in the truck at the end of the day. It would be faster on a tablet on site.',
  'Nothing major this quarter.',
];

export const CHECKIN_ONE_THING = [
  'Get the material list to the yard two days ahead instead of one.',
  'Start the daily brief at 6:50 so we are moving by 7:00.',
  'Book the inspection as soon as the rough-in is scheduled, not when it is done.',
  'Ask for help by Wednesday if the week is going sideways.',
];

export const GOAL_COMMENT = [
  'Hit the target with a month to spare. The weekly check on material waste made the difference.',
  'Came up short, and the reason was the two months we were short-staffed rather than anything about the approach.',
  'Partly done. The training is complete but the sign-offs are still outstanding.',
  'Good progress and worth carrying into next year rather than closing it.',
  'This one stopped being the right goal in about March when the job mix changed. We should have retired it then.',
];

export const NEW_HIRE_SUMMARY = [
  'Good first 90 days. Shows up ready, asks before guessing, and has not needed to be told twice about protective equipment. Still learning layout, which is exactly where a new apprentice should be.',
  'Settling in well. Fits the crew, takes direction, and the quality of what has been assigned so far is clean. Next 90 days should add layout and plan reading.',
];
