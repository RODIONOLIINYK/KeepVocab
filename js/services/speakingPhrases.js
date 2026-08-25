const DAY_MS = 86_400_000;

const profile = (id, lessonIds, vocabularyTerms, phrases) => ({ id, lessonIds, vocabularyTerms, phrases });
const phrase = (id, text, meaning, example) => ({ id, text, meaning, example, nonLiteral: true });

export const SPEAKING_CONTEXT_PROFILES = [
  profile('small-talk', ['coffee-small-talk', 'introduce-yourself'], 'conversation stranger introduce friendly chat relax awkward welcome cafe customer barista', [
    phrase('break-the-ice', 'break the ice', 'make people feel more relaxed when a conversation begins', 'A friendly question can break the ice.'),
    phrase('hit-it-off', 'hit it off', 'quickly form a friendly connection with someone', 'We hit it off as soon as we started talking.'),
    phrase('warm-to-someone', 'warm to someone', 'gradually begin to like or trust someone', 'I warmed to her after a few minutes.'),
  ]),
  profile('navigation', ['ask-directions'], 'direction route map location nearby street turn landmark distance local visitor lost find', [
    phrase('get-your-bearings', 'get your bearings', 'work out where you are and which direction to go', 'I need a minute to get my bearings.'),
    phrase('stone-throw', 'a stone’s throw away', 'very close to a place', 'The station is a stone’s throw away.'),
    phrase('off-beaten-track', 'off the beaten track', 'away from places that most visitors go to', 'The café is a little off the beaten track.'),
  ]),
  profile('consumer', ['shopping-return', 'compare-phone-plans', 'bank-charge', 'repair-service', 'choose-gym'], 'buy price cost fee charge refund return exchange repair service contract membership value expensive cheap faulty broken quality guarantee consumer money bank', [
    phrase('rip-off', 'a rip-off', 'something that costs much more than it is worth', 'That cancellation fee feels like a rip-off.'),
    phrase('up-to-scratch', 'not up to scratch', 'not reaching the expected standard or quality', 'The repair was not up to scratch.'),
    phrase('money-worth', 'get your money’s worth', 'receive enough value for the money you spend', 'I want to be sure I’ll get my money’s worth.'),
  ]),
  profile('health', ['doctor-appointment', 'second-opinion'], 'health doctor medical symptom pain illness treatment diagnosis recover sick medicine patient condition advice', [
    phrase('under-weather', 'under the weather', 'feeling slightly ill', 'I’ve been feeling under the weather all week.'),
    phrase('on-the-mend', 'on the mend', 'recovering after an illness or injury', 'I’m finally on the mend.'),
    phrase('clean-bill-health', 'a clean bill of health', 'confirmation that someone is healthy', 'The doctor gave me a clean bill of health.'),
  ]),
  profile('housing', ['rent-apartment', 'neighbor-noise', 'organize-house-move'], 'home house apartment rent landlord tenant room neighborhood noise move furniture space property location quiet', [
    phrase('make-yourself-home', 'make yourself at home', 'relax and behave as comfortably as you would at home', 'Please come in and make yourself at home.'),
    phrase('live-out-boxes', 'live out of boxes', 'live without unpacking after a move', 'I don’t want to live out of boxes for weeks.'),
    phrase('peace-and-quiet', 'peace and quiet', 'a calm situation without unwanted noise or interruption', 'I need some peace and quiet in the evenings.'),
  ]),
  profile('community', ['community-volunteer'], 'community volunteer help support people event organize local charity contribute project team', [
    phrase('pitch-in', 'pitch in', 'join other people in helping with a task', 'Everyone can pitch in for an hour.'),
    phrase('roll-up-sleeves', 'roll up your sleeves', 'prepare to work hard on a practical task', 'We need to roll up our sleeves and get started.'),
    phrase('pull-together', 'pull together', 'cooperate closely in a difficult situation', 'The neighborhood really pulled together.'),
  ]),
  profile('travel-logistics', ['airport-checkin', 'lost-luggage', 'change-booking', 'missed-connection', 'insurance-claim'], 'flight airport ticket booking reservation luggage baggage connection delay cancel change passenger claim insurance document passport desk travel', [
    phrase('hit-a-snag', 'hit a snag', 'encounter an unexpected problem', 'We hit a snag when the first flight was delayed.'),
    phrase('in-same-boat', 'in the same boat', 'be in the same difficult situation as other people', 'Several passengers are in the same boat.'),
    phrase('miss-the-boat', 'miss the boat', 'lose an opportunity by acting too late', 'I don’t want to miss the boat on the last available flight.'),
  ]),
  profile('hospitality', ['hotel-problem', 'restaurant-order', 'rental-damage'], 'hotel room restaurant meal food order booking guest staff car rental damage service complaint bill menu', [
    phrase('on-the-house', 'on the house', 'provided free by a business', 'The manager offered breakfast on the house.'),
    phrase('make-a-fuss', 'make a fuss', 'complain or react more strongly than usual', 'I don’t want to make a fuss, but the room is not clean.'),
    phrase('leave-bad-taste', 'leave a bad taste in your mouth', 'cause a lasting unpleasant feeling about an experience', 'The extra charge left a bad taste in my mouth.'),
  ]),
  profile('exploration', ['sightseeing-plan', 'local-customs', 'sustainable-trip', 'tour-debate'], 'visit sightseeing attraction culture custom local museum tour guide trip explore environment sustainable transport place city', [
    phrase('hidden-gem', 'a hidden gem', 'an excellent place that few people know about', 'That small museum is a hidden gem.'),
    phrase('broaden-horizons', 'broaden your horizons', 'increase your knowledge and experience of the world', 'Staying with local people can broaden your horizons.'),
    phrase('off-beaten-track', 'off the beaten track', 'away from places that most visitors go to', 'We could choose a route off the beaten track.'),
  ]),
  profile('travel-emergency', ['travel-emergency'], 'emergency danger help police hospital safe accident lost urgent passport embassy travel problem', [
    phrase('keep-cool-head', 'keep a cool head', 'stay calm in a stressful situation', 'We need to keep a cool head and call the embassy.'),
    phrase('out-of-blue', 'out of the blue', 'suddenly and unexpectedly', 'The cancellation came out of the blue.'),
    phrase('tight-spot', 'get out of a tight spot', 'escape from a difficult situation', 'The hotel staff helped us get out of a tight spot.'),
  ]),
  profile('travel-planning', ['negotiate-itinerary'], 'itinerary plan schedule group preference compromise destination activity budget time agree travel', [
    phrase('meet-halfway', 'meet halfway', 'reach a compromise by both giving up part of what you want', 'Could we meet halfway and spend one day in each place?'),
    phrase('set-in-stone', 'set in stone', 'fixed and impossible to change', 'The itinerary is not set in stone yet.'),
    phrase('play-it-by-ear', 'play it by ear', 'decide what to do as a situation develops', 'We can book the hotel and play the rest by ear.'),
  ]),
  profile('workplace-chat', ['team-small-talk', 'professional-networking'], 'colleague coworker office work career profession network introduce meeting update company contact', [
    phrase('touch-base', 'touch base', 'speak briefly to exchange updates', 'Let’s touch base after the meeting.'),
    phrase('in-the-loop', 'in the loop', 'kept informed about what is happening', 'Please keep me in the loop.'),
    phrase('get-up-to-speed', 'get up to speed', 'learn the latest information or reach the required level', 'I’m still getting up to speed with the project.'),
  ]),
  profile('project-progress', ['daily-standup', 'clarify-brief', 'explain-delay'], 'project task deadline delay schedule scope requirement progress blocker client delivery workload capacity priority brief quality', [
    phrase('back-on-track', 'get back on track', 'return to the planned course or schedule', 'The extra developer should help us get back on track.'),
    phrase('hit-roadblock', 'hit a roadblock', 'encounter a problem that stops progress', 'We hit a roadblock during testing.'),
    phrase('against-clock', 'be up against the clock', 'have very little time left to finish something', 'We are up against the clock this week.'),
  ]),
  profile('persuasion', ['present-idea', 'persuasive-pitch'], 'idea proposal pitch persuade benefit value audience solution support evidence product decision', [
    phrase('bring-to-table', 'bring something to the table', 'offer a useful skill, quality, or advantage', 'This approach brings two major benefits to the table.'),
    phrase('win-over', 'win someone over', 'persuade someone to support or like an idea', 'The pilot results may win the client over.'),
    phrase('speak-for-itself', 'speak for itself', 'be so clear or convincing that no explanation is needed', 'The improvement in retention speaks for itself.'),
  ]),
  profile('work-negotiation', ['negotiate-deadline', 'say-no-work', 'salary-review'], 'deadline time schedule negotiate compromise constraint workload capacity delivery commit postpone extension salary pay responsibility performance budget client scope', [
    phrase('buy-some-time', 'buy some time', 'create a short delay so there is more time to act', 'A phased launch would buy us some time.'),
    phrase('meet-halfway', 'meet halfway', 'reach a compromise by both giving up part of what you want', 'Could we meet halfway on the delivery date?'),
    phrase('draw-the-line', 'draw the line', 'set a firm limit on what you will accept', 'I have to draw the line at taking on another full project.'),
  ]),
  profile('feedback-conflict', ['give-feedback', 'leadership-coaching', 'team-conflict'], 'feedback conflict disagree teammate manager performance improve behavior issue responsibility listen resolve tension relationship', [
    phrase('clear-the-air', 'clear the air', 'discuss a problem openly so tension is removed', 'I’d like to clear the air before the next meeting.'),
    phrase('take-on-board', 'take something on board', 'consider and accept feedback or an idea', 'I hope you’ll take this feedback on board.'),
    phrase('see-eye-to-eye', 'see eye to eye', 'agree fully with another person', 'We do not always see eye to eye, but we can still cooperate.'),
  ]),
  profile('career', ['job-interview'], 'job interview career employer candidate skill experience hire role responsibility achievement work', [
    phrase('foot-in-door', 'get your foot in the door', 'gain an initial opportunity that may lead to something bigger', 'The internship helped me get my foot in the door.'),
    phrase('bring-to-table', 'bring something to the table', 'offer a useful skill, quality, or advantage', 'I bring strong research skills to the table.'),
    phrase('learn-the-ropes', 'learn the ropes', 'learn how a job or organization works', 'I learned the ropes quickly in my previous role.'),
  ]),
  profile('meeting', ['chair-meeting', 'client-discovery'], 'meeting agenda client question need requirement decision stakeholder discuss summarize issue outcome business', [
    phrase('ball-rolling', 'get the ball rolling', 'start an activity or process', 'Let’s get the ball rolling with the main question.'),
    phrase('cut-to-chase', 'cut to the chase', 'focus immediately on the most important point', 'Could we cut to the chase and define the real problem?'),
    phrase('same-page', 'be on the same page', 'share the same understanding of a situation', 'I want to make sure we are on the same page.'),
  ]),
  profile('work-policy', ['remote-policy'], 'policy remote office employee manager productivity fairness flexible company team rule consistent benefit risk', [
    phrase('strike-balance', 'strike a balance', 'find a fair position between competing needs', 'The policy needs to strike a balance between flexibility and fairness.'),
    phrase('level-playing-field', 'a level playing field', 'a situation in which everyone has a fair chance', 'The rules should create a level playing field.'),
    phrase('draw-the-line', 'draw the line', 'set a firm limit on what you will accept', 'We should draw the line at roles that cannot be done safely from home.'),
  ]),
  profile('social-connection', ['meet-new-person', 'reconnect-friend', 'cultural-exchange'], 'friend person meet relationship conversation culture connect memory life share new old social', [
    phrase('break-the-ice', 'break the ice', 'make people feel more relaxed when a conversation begins', 'That question really broke the ice.'),
    phrase('hit-it-off', 'hit it off', 'quickly form a friendly connection with someone', 'We hit it off straight away.'),
    phrase('pick-up-left-off', 'pick up where you left off', 'continue a relationship or activity after a pause', 'It felt as if we could pick up where we left off.'),
  ]),
  profile('social-plans', ['make-plans', 'group-holiday'], 'friend plan schedule invite holiday group budget activity choose arrange available decide', [
    phrase('up-in-air', 'up in the air', 'not yet decided or settled', 'The dates are still up in the air.'),
    phrase('rain-check', 'take a rain check', 'decline an invitation now but suggest accepting it later', 'Could I take a rain check on dinner?'),
    phrase('play-it-by-ear', 'play it by ear', 'decide what to do as a situation develops', 'Let’s meet in town and play it by ear.'),
  ]),
  profile('social-disagreement', ['disagree-politely', 'repair-misunderstanding', 'set-boundary'], 'disagree misunderstanding conflict apology intention feeling boundary relationship trust clarify blame upset friend', [
    phrase('clear-the-air', 'clear the air', 'discuss a problem openly so tension is removed', 'Can we talk and clear the air?'),
    phrase('crossed-wires', 'get your wires crossed', 'misunderstand each other', 'I think we got our wires crossed.'),
    phrase('see-eye-to-eye', 'see eye to eye', 'agree fully with another person', 'We may not see eye to eye on this.'),
  ]),
  profile('story', ['tell-story', 'recommend-story'], 'story book film movie character plot event memory describe recommend ending audience interesting', [
    phrase('plot-thickens', 'the plot thickens', 'a situation or story becomes more complicated or mysterious', 'Then an old friend appears, and the plot thickens.'),
    phrase('steal-the-show', 'steal the show', 'attract the most attention in a performance or event', 'The supporting actor completely stole the show.'),
    phrase('twist-of-fate', 'a twist of fate', 'an unexpected event that changes what happens', 'By a twist of fate, they meet again years later.'),
  ]),
  profile('hobbies', ['talk-hobbies'], 'hobby sport music art activity free time enjoy practice skill interest weekend', [
    phrase('right-up-street', 'right up your street', 'exactly suited to your interests or abilities', 'This photography course would be right up your street.'),
    phrase('lose-track-time', 'lose track of time', 'become unaware of how much time has passed', 'I lose track of time when I’m painting.'),
    phrase('get-hang', 'get the hang of it', 'learn how to do something through practice', 'It was difficult at first, but I got the hang of it.'),
  ]),
  profile('support', ['support-friend'], 'friend stress support advice listen pressure difficult feeling help problem quiet', [
    phrase('rough-patch', 'go through a rough patch', 'experience a difficult period in life', 'It sounds as though you’re going through a rough patch.'),
    phrase('weight-off-shoulders', 'take a weight off your shoulders', 'remove a source of worry or responsibility', 'Talking about it might take a weight off your shoulders.'),
    phrase('shoulder-to-cry-on', 'a shoulder to cry on', 'a person who listens sympathetically when someone is upset', 'I can be a shoulder to cry on if that is what you need.'),
  ]),
  profile('social-discussion', ['host-discussion', 'explain-tradition'], 'discussion opinion group culture tradition view involve explain belief guest talk difference', [
    phrase('food-for-thought', 'food for thought', 'an idea worth considering carefully', 'That example gives us plenty of food for thought.'),
    phrase('agree-disagree', 'agree to disagree', 'accept that two people will keep different opinions', 'We may need to agree to disagree on that point.'),
    phrase('word-edgeways', 'get a word in edgeways', 'manage to speak in a conversation dominated by others', 'Let’s give Maya a chance to get a word in edgeways.'),
  ]),
  profile('academic-explanation', ['explain-concept', 'summarize-article', 'explain-trend', 'critique-source'], 'explain concept article source evidence trend data meaning summary research information limitation interpretation', [
    phrase('shed-light', 'shed light on', 'help people understand something more clearly', 'The latest data sheds light on the change.'),
    phrase('in-nutshell', 'in a nutshell', 'in a very brief and clear form', 'In a nutshell, the article challenges the usual explanation.'),
    phrase('get-point-across', 'get your point across', 'communicate an idea successfully', 'A concrete example will help you get your point across.'),
  ]),
  profile('academic-discussion', ['seminar-discussion', 'friendly-debate', 'defend-claim', 'research-ethics'], 'argument claim debate evidence opinion counterargument ethics research discussion support objection reason', [
    phrase('stand-up-scrutiny', 'stand up to scrutiny', 'remain convincing after careful examination', 'The claim does not stand up to scrutiny.'),
    phrase('grey-area', 'a grey area', 'a situation without a clear right or wrong answer', 'Informed consent is a grey area in this case.'),
    phrase('food-for-thought', 'food for thought', 'an idea worth considering carefully', 'That objection gives us food for thought.'),
  ]),
  profile('study', ['office-hours', 'exam-prep', 'oral-exam'], 'study exam professor tutor question answer learn remember revise prepare student course uncertain', [
    phrase('draw-a-blank', 'draw a blank', 'be unable to remember something', 'I knew the answer, but I drew a blank.'),
    phrase('hit-the-books', 'hit the books', 'begin studying seriously', 'I need to hit the books this weekend.'),
    phrase('learn-by-heart', 'learn by heart', 'memorize something exactly', 'I learned the key definitions by heart.'),
  ]),
  profile('group-project', ['group-project', 'campus-change'], 'project group team proposal plan scope task responsibility deliver budget university campus improve staff', [
    phrase('pull-your-weight', 'pull your weight', 'do your fair share of a group task', 'Everyone needs to pull their weight.'),
    phrase('divide-and-conquer', 'divide and conquer', 'split a large task into smaller parts and handle them separately', 'Let’s divide and conquer the research.'),
    phrase('ball-rolling', 'get the ball rolling', 'start an activity or process', 'A small pilot could get the ball rolling.'),
  ]),
  profile('analysis', ['compare-solutions'], 'compare solution option criterion evidence strength weakness choose decision result cost benefit evaluate', [
    phrase('bigger-picture', 'the bigger picture', 'the whole situation rather than one small detail', 'Cost matters, but we should look at the bigger picture.'),
    phrase('apples-oranges', 'compare apples and oranges', 'compare things that are too different for the comparison to be fair', 'Those two measures may be comparing apples and oranges.'),
    phrase('rule-of-thumb', 'a rule of thumb', 'a practical general guideline rather than an exact rule', 'As a rule of thumb, reliability should come before speed.'),
  ]),
  profile('crisis', ['crisis-update'], 'crisis emergency company update risk damage response public media problem urgent plan recover stakeholder', [
    phrase('weather-storm', 'weather the storm', 'survive a difficult period or crisis', 'The company has enough reserves to weather the storm.'),
    phrase('damage-control', 'damage control', 'action taken to limit harm after a problem', 'Our immediate priority is damage control.'),
    phrase('keep-lid-on', 'keep a lid on', 'prevent a difficult situation from growing or becoming public', 'We need accurate updates to keep a lid on speculation.'),
  ]),
  profile('ethics', ['ethical-debate', 'privacy-tradeoff', 'climate-responsibility'], 'ethics moral privacy consent responsibility risk benefit harm fair decision government company individual data climate', [
    phrase('slippery-slope', 'a slippery slope', 'a first step that may lead to increasingly harmful consequences', 'Collecting optional data could become a slippery slope.'),
    phrase('double-edged-sword', 'a double-edged sword', 'something with both important benefits and serious disadvantages', 'Personalization can be a double-edged sword.'),
    phrase('draw-the-line', 'draw the line', 'set a firm moral or practical limit', 'We need to draw the line at sharing data without consent.'),
  ]),
  profile('public-speaking', ['impromptu-speech'], 'speech speak audience presentation topic answer prepare confident idea organize public', [
    phrase('think-on-feet', 'think on your feet', 'react and form ideas quickly without preparation', 'This exercise teaches you to think on your feet.'),
    phrase('off-the-cuff', 'off the cuff', 'spoken without being prepared in advance', 'I had to give an off-the-cuff response.'),
    phrase('lose-train-thought', 'lose your train of thought', 'forget the sequence of ideas you were expressing', 'I paused because I lost my train of thought.'),
  ]),
  profile('media', ['media-bias'], 'news media article source fact bias framing claim verify report audience information trust', [
    phrase('read-between-lines', 'read between the lines', 'look for a meaning that is implied rather than directly stated', 'You have to read between the lines to notice the framing.'),
    phrase('grain-of-salt', 'take something with a grain of salt', 'avoid believing something completely without more evidence', 'I would take that headline with a grain of salt.'),
    phrase('only-one-side', 'tell only one side of the story', 'present information that supports just one viewpoint', 'The report tells only one side of the story.'),
  ]),
  profile('technology-work', ['ai-work-debate', 'future-work'], 'technology artificial intelligence automation job work skill worker retrain productivity future change system human', [
    phrase('game-changer', 'a game changer', 'something that changes a situation in a major way', 'Reliable automation could be a game changer.'),
    phrase('double-edged-sword', 'a double-edged sword', 'something with both important benefits and serious disadvantages', 'AI is a double-edged sword for many workers.'),
    phrase('keep-pace', 'keep pace with', 'develop or move quickly enough to match change', 'Training needs to keep pace with automation.'),
  ]),
  profile('public-policy', ['city-transport', 'education-reform', 'health-priorities'], 'policy public government city transport education health budget resource fair cost benefit citizen student patient priority assessment', [
    phrase('tip-iceberg', 'the tip of the iceberg', 'the small visible part of a much larger problem', 'Traffic delays are only the tip of the iceberg.'),
    phrase('strike-balance', 'strike a balance', 'find a fair position between competing needs', 'The plan must strike a balance between access and cost.'),
    phrase('move-goalposts', 'move the goalposts', 'change the rules or expectations after a process has begun', 'We should not move the goalposts halfway through the assessment year.'),
  ]),
  profile('free-conversation', ['free-conversation'], 'conversation topic opinion experience life work study culture event idea feeling', [
    phrase('food-for-thought', 'food for thought', 'an idea worth considering carefully', 'That gives me a lot of food for thought.'),
    phrase('put-finger-on', 'put your finger on', 'identify the exact cause or nature of something', 'You have put your finger on the real issue.'),
    phrase('see-where-coming-from', 'see where someone is coming from', 'understand the reasons behind someone’s opinion', 'I see where you’re coming from, even though I disagree.'),
  ]),
];

const PROFILE_BY_LESSON = new Map(SPEAKING_CONTEXT_PROFILES.flatMap(item => item.lessonIds.map(lessonId => [lessonId, item])));

export function getSpeakingContextProfile(lesson) {
  return PROFILE_BY_LESSON.get(lesson?.id) || SPEAKING_CONTEXT_PROFILES.at(-1);
}

export function getLessonPhrases(lesson) {
  const context = getSpeakingContextProfile(lesson);
  return context.phrases.map(item => ({ ...item, profileId: context.id, progressId: `${context.id}:${item.id}` }));
}

function libraryPhraseKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function lessonPhraseLibraryEntries(lesson) {
  return getLessonPhrases(lesson).map(target => ({
    word: target.text,
    partOfSpeech: 'idiomatic expression',
    definition: target.meaning,
    example: target.example,
    exampleAttribution: 'KeepVocab speaking lesson',
    exampleSourceUrl: '',
    exampleLicense: '',
  }));
}

export function lessonPhrasesMissingFromLibrary(lesson, existingWords = []) {
  const existing = new Set((existingWords || []).map(word => `${libraryPhraseKey(word.word)}|${libraryPhraseKey(word.definition)}`));
  return lessonPhraseLibraryEntries(lesson).filter(entry => !existing.has(`${libraryPhraseKey(entry.word)}|${libraryPhraseKey(entry.definition)}`));
}

export function saveLessonPhrasesToLibrary(lesson, library) {
  if (!library?.getWords || !library?.addWords) throw new Error('The Library is unavailable.');
  const total = lessonPhraseLibraryEntries(lesson).length;
  const missing = lessonPhrasesMissingFromLibrary(lesson, library.getWords());
  const saved = missing.length ? library.addWords(missing) : [];
  return { total, saved, alreadyPresent: total - saved.length };
}

function progressFor(progress, target) {
  return progress?.phraseProgress?.[target.progressId] || {};
}

export function phraseLearningStatus(target, progress, now = new Date()) {
  const saved = progressFor(progress, target);
  if (!saved.exposures) return { label: 'New expression', due: true };
  const due = !saved.nextReviewAt || Date.parse(saved.nextReviewAt) <= now.getTime();
  return { label: due ? 'Due for recall' : 'Learning', due };
}

export function selectPhrasesForLesson(lesson, progress = {}, { limit = 2, now = new Date() } = {}) {
  return getLessonPhrases(lesson)
    .map((target, index) => {
      const saved = progressFor(progress, target);
      const dueAt = saved.nextReviewAt ? Date.parse(saved.nextReviewAt) : 0;
      const due = !saved.exposures || !Number.isFinite(dueAt) || dueAt <= now.getTime();
      return { target, index, due, dueAt, exposures: Number(saved.exposures || 0) };
    })
    .sort((a, b) => Number(b.due) - Number(a.due) || a.exposures - b.exposures || a.dueAt - b.dueAt || a.index - b.index)
    .slice(0, limit)
    .map(item => item.target);
}

function phraseUsed(target, transcript) {
  const learnerText = (transcript || []).filter(entry => entry.role === 'learner').map(entry => entry.text).join(' ').toLowerCase();
  const normalizedPhrase = target.text.toLowerCase().replace(/[’']/g, "'");
  const normalizedText = learnerText.replace(/[’']/g, "'");
  return normalizedText.includes(normalizedPhrase);
}

export function recordPhrasePractice(progress, targets, transcript, now = new Date()) {
  const next = { ...(progress?.phraseProgress || {}) };
  const results = [];
  for (const target of targets || []) {
    const previous = next[target.progressId] || {};
    const used = phraseUsed(target, transcript);
    const streak = used ? Number(previous.streak || 0) + 1 : 0;
    const intervalDays = used ? [1, 3, 7, 14, 30][Math.min(streak, 5) - 1] : 1;
    const nextReviewAt = new Date(now.getTime() + intervalDays * DAY_MS).toISOString();
    next[target.progressId] = {
      exposures: Number(previous.exposures || 0) + 1,
      successes: Number(previous.successes || 0) + Number(used),
      streak,
      lastPracticedAt: now.toISOString(),
      nextReviewAt,
    };
    results.push({ target, used, intervalDays, nextReviewAt });
  }
  return { phraseProgress: next, results };
}

export function buildPhraseCoachingInstruction(targets) {
  if (!targets?.length) return '';
  const descriptions = targets.map(target => `“${target.text}” means “${target.meaning}”; model: “${target.example}”`).join(' | ');
  return `\nIDIOM RETENTION PLAN: Teach only these non-literal expressions: ${descriptions}.
- Introduce the first expression in context and briefly explain its meaning; do not merely display a list.
- Ask the learner to repeat it once in a personalized sentence.
- At least two learner turns later, create a new opening for the same expression and ask for it from memory without saying it first.
- If recall fails, give the meaning and first two words, then let the learner complete it.
- Recycle the second expression in the same introduce → delayed recall pattern.
- Near the end, ask the learner to use one expression again in a different sentence. Keep this reinforcement inside the role-play.`;
}

export function detectUsedPhrases(targets, transcript) {
  return (targets || []).filter(target => phraseUsed(target, transcript));
}
