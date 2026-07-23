export const SPEAKING_CATEGORIES = [
  { id: 'everyday', label: 'Everyday life', icon: 'fa-mug-hot', tone: 'blue' },
  { id: 'travel', label: 'Travel', icon: 'fa-plane', tone: 'purple' },
  { id: 'work', label: 'Work', icon: 'fa-briefcase', tone: 'orange' },
  { id: 'social', label: 'Social', icon: 'fa-comments', tone: 'pink' },
  { id: 'academic', label: 'Academic', icon: 'fa-book-open-reader', tone: 'cyan' },
  { id: 'advanced', label: 'Advanced', icon: 'fa-chart-line', tone: 'green' }
];

const lessons = [
  ['coffee-small-talk', 'Coffee shop small talk', 'everyday', 'A2', 6, 'Start and keep a friendly conversation at a coffee shop.', 'a customer', 'a friendly barista', ['Could I have…?', 'What would you recommend?', 'That sounds great.']],
  ['introduce-yourself', 'Introduce yourself naturally', 'everyday', 'A1', 5, 'Share who you are and ask simple follow-up questions.', 'a new class member', 'another learner', ['I’m originally from…', 'What about you?', 'Nice to meet you.']],
  ['ask-directions', 'Ask for directions', 'everyday', 'A2', 7, 'Find a place and confirm that you understood the route.', 'a visitor', 'a helpful local', ['How do I get to…?', 'Is it far from here?', 'Let me check I understood.']],
  ['shopping-return', 'Return something to a shop', 'everyday', 'B1', 8, 'Explain a problem and negotiate a practical solution.', 'a customer', 'a shop assistant', ['I’d like to return this.', 'The problem is…', 'Could I exchange it instead?']],
  ['doctor-appointment', 'At a doctor’s appointment', 'everyday', 'B1', 9, 'Describe symptoms clearly and ask about next steps.', 'a patient', 'a doctor', ['I’ve been feeling…', 'It started three days ago.', 'What should I do next?']],
  ['rent-apartment', 'View an apartment', 'everyday', 'B2', 10, 'Ask detailed questions before deciding whether to rent.', 'a prospective tenant', 'a letting agent', ['Is the rent inclusive of bills?', 'How long is the lease?', 'I’d like to think it over.']],

  ['airport-checkin', 'Airport check-in', 'travel', 'A2', 7, 'Check in, handle requests, and understand gate instructions.', 'a passenger', 'an airline agent', ['I’d like to check in.', 'Could I have an aisle seat?', 'Which gate should I use?']],
  ['hotel-problem', 'Solve a hotel problem', 'travel', 'B1', 8, 'Report a room problem politely and agree on a solution.', 'a hotel guest', 'the front desk manager', ['There seems to be a problem with…', 'Could someone take a look?', 'That solution works for me.']],
  ['restaurant-order', 'Order at a restaurant', 'travel', 'A2', 7, 'Ask about a menu, order confidently, and handle changes.', 'a diner', 'a waiter', ['What does this come with?', 'I’ll have…', 'Could I get that without…?']],
  ['lost-luggage', 'Report lost luggage', 'travel', 'B1', 9, 'Describe a missing bag and understand the recovery process.', 'a traveler', 'a baggage service agent', ['My bag didn’t arrive.', 'It looks like…', 'How can I track the claim?']],
  ['sightseeing-plan', 'Plan a day of sightseeing', 'travel', 'B1', 8, 'Compare attractions and build a realistic plan together.', 'a traveler', 'a local guide', ['I’m interested in…', 'Which would you prioritize?', 'Let’s start with…']],
  ['travel-emergency', 'Handle a travel emergency', 'travel', 'B2', 10, 'Stay calm, explain what happened, and request urgent help.', 'a traveler in difficulty', 'an emergency support agent', ['I need help with…', 'Here is what happened.', 'What should I do immediately?']],

  ['team-small-talk', 'Team small talk', 'work', 'A2', 6, 'Join an informal workplace conversation naturally.', 'a new teammate', 'a colleague', ['How has your week been?', 'I’m still getting used to…', 'That sounds interesting.']],
  ['daily-standup', 'Give a stand-up update', 'work', 'B1', 7, 'Summarize progress, blockers, and the next action.', 'a project contributor', 'a team lead', ['Yesterday I worked on…', 'The main blocker is…', 'Next, I’m going to…']],
  ['present-idea', 'Present your idea', 'work', 'B1', 8, 'Present an idea clearly and answer follow-up questions.', 'a product specialist', 'a curious stakeholder', ['The key idea is…', 'The benefit would be…', 'That’s a fair question.']],
  ['negotiate-deadline', 'Negotiate a deadline', 'work', 'B2', 9, 'Explain constraints and reach a workable compromise.', 'a project owner', 'a demanding client', ['Given the current scope…', 'What I can commit to is…', 'Could we agree on…?']],
  ['give-feedback', 'Give constructive feedback', 'work', 'B2', 9, 'Give specific feedback while protecting the relationship.', 'a supportive manager', 'a teammate', ['One thing that worked well was…', 'I noticed that…', 'A useful next step could be…']],
  ['job-interview', 'Job interview', 'work', 'B2', 10, 'Answer common interview questions with concrete examples.', 'a job candidate', 'a hiring manager', ['A good example is…', 'My contribution was…', 'What I learned was…']],

  ['meet-new-person', 'Meet someone new', 'social', 'A2', 6, 'Open a conversation and discover shared interests.', 'a guest at a gathering', 'another guest', ['How do you know the host?', 'What do you enjoy doing?', 'We have that in common.']],
  ['make-plans', 'Make plans with a friend', 'social', 'A2', 6, 'Suggest, compare, and agree on plans.', 'a friend', 'another friend', ['Are you free on…?', 'How about…?', 'That works for me.']],
  ['disagree-politely', 'Disagree politely', 'social', 'B1', 7, 'Express a different opinion and keep the tone positive.', 'a thoughtful friend', 'a friend with another view', ['I see your point, but…', 'From my perspective…', 'We may have to agree to disagree.']],
  ['tell-story', 'Tell a great story', 'social', 'B2', 9, 'Engage a listener with clear structure and vivid details.', 'a storyteller', 'an interested friend', ['It all started when…', 'The surprising part was…', 'In the end…']],
  ['talk-hobbies', 'Talk about your hobbies', 'social', 'A2', 7, 'Describe what you enjoy and why it matters to you.', 'a hobby enthusiast', 'a curious acquaintance', ['I got into it because…', 'What I enjoy most is…', 'You should try it sometime.']],
  ['cultural-exchange', 'Cultural exchange', 'social', 'B2', 10, 'Compare traditions with curiosity and without stereotypes.', 'a cultural ambassador', 'an international friend', ['In my experience…', 'Is it similar where you live?', 'I was surprised to learn…']],

  ['explain-concept', 'Explain a difficult concept', 'academic', 'B1', 8, 'Make a complex idea understandable with an example.', 'a student tutor', 'a curious classmate', ['In simple terms…', 'For example…', 'The main difference is…']],
  ['seminar-discussion', 'Join a seminar discussion', 'academic', 'B2', 10, 'Enter a discussion, build on an idea, and ask a question.', 'a seminar participant', 'a discussion leader', ['I’d like to build on that.', 'The evidence suggests…', 'Could you clarify…?']],
  ['summarize-article', 'Summarize an article', 'academic', 'B2', 9, 'Identify the main argument and explain supporting points.', 'a student presenter', 'a professor', ['The article argues that…', 'The author supports this by…', 'Overall, the key point is…']],
  ['friendly-debate', 'Take part in a debate', 'academic', 'C1', 11, 'Build a reasoned position and respond to a counterargument.', 'a debate participant', 'an opposing speaker', ['My position rests on…', 'That argument overlooks…', 'A stronger interpretation is…']],
  ['office-hours', 'Talk to a professor', 'academic', 'B2', 8, 'Ask for clarification and discuss how to improve.', 'a university student', 'a professor', ['I’m having trouble with…', 'Could you explain why…?', 'How can I improve this?']],
  ['exam-prep', 'Plan exam preparation', 'academic', 'B1', 8, 'Evaluate priorities and agree on an effective study plan.', 'a student', 'a study coach', ['I need to focus on…', 'My weakest area is…', 'I’ll set aside time for…']],

  ['crisis-update', 'Give a crisis update', 'advanced', 'C1', 11, 'Communicate bad news calmly, clearly, and responsibly.', 'a team spokesperson', 'a concerned stakeholder', ['Here is what we know.', 'We are currently addressing…', 'I’ll update you as soon as…']],
  ['professional-networking', 'Professional networking', 'advanced', 'C1', 10, 'Start a meaningful professional conversation and follow up.', 'a conference attendee', 'an industry expert', ['I’ve been following your work on…', 'My focus is…', 'Would you be open to…?']],
  ['leadership-coaching', 'Coach a team member', 'advanced', 'C1', 12, 'Use questions to help someone find their own solution.', 'a team lead', 'a teammate facing a challenge', ['What outcome are you aiming for?', 'What options have you considered?', 'What support would help?']],
  ['ethical-debate', 'Discuss an ethical dilemma', 'advanced', 'C1', 12, 'Explore competing values and defend a nuanced judgment.', 'a panel member', 'another panelist', ['The ethical tension is…', 'We should distinguish between…', 'On balance, I would argue…']],
  ['persuasive-pitch', 'Make a persuasive pitch', 'advanced', 'C1', 10, 'Adapt a concise pitch to a skeptical listener.', 'a founder', 'a skeptical investor', ['The problem we solve is…', 'What makes this different is…', 'The evidence for demand is…']],
  ['impromptu-speech', 'Impromptu speaking', 'advanced', 'C1', 8, 'Organize an unfamiliar topic into a confident short speech.', 'an impromptu speaker', 'an attentive audience', ['My first thought is…', 'There are three reasons…', 'To sum up…']]
];

export const SPEAKING_LESSONS = lessons.map(([id, title, category, level, duration, goal, learnerRole, coachRole, targetPhrases], index) => ({
  id, title, category, level, duration, goal, learnerRole, coachRole, targetPhrases,
  order: index + 1
}));

export const FREE_CONVERSATION_LESSON = {
  id: 'free-conversation', title: 'Free conversation', category: 'social', level: 'Any', duration: 12,
  goal: 'Build fluency in a natural conversation about a topic you choose.',
  learnerRole: 'yourself', coachRole: 'a warm and curious conversation partner',
  targetPhrases: ['Could you tell me more?', 'What I mean is…', 'Let me put it another way.'], freeConversation: true
};

export function getSpeakingLesson(id) {
  return id === FREE_CONVERSATION_LESSON.id ? FREE_CONVERSATION_LESSON : SPEAKING_LESSONS.find(lesson => lesson.id === id);
}

export function buildSpeakingInstruction(lesson) {
  return `You are Mira, KeepVocab's encouraging English speaking coach. Run a short live role-play lesson.
Lesson: ${lesson.title}.
Learner level: ${lesson.level}.
Goal: ${lesson.goal}
The learner is ${lesson.learnerRole}; you are ${lesson.coachRole}.
Useful target phrases: ${lesson.targetPhrases.join('; ')}.

Speak only in English unless the learner explicitly asks for a brief translation. Begin with one short, natural line that immediately starts the scenario. Keep each turn concise so the learner speaks more than you. Ask one question at a time. Adapt your pace and vocabulary to the learner's level. If an error blocks meaning, give a gentle one-sentence correction and invite the learner to say the improved version once; otherwise do not interrupt fluency. Notice grammar, word choice, clarity, and clearly audible pronunciation issues, but never pretend to provide phoneme-level scoring. Encourage the target phrases naturally rather than forcing all of them. If the learner says they want to finish, give a concise spoken recap: one strength, one correction, and one useful phrase to remember. Never claim the session is recorded or saved remotely by KeepVocab.`;
}
