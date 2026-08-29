const p = (lt, en, acceptedForms = []) => ({ lt, en, acceptedForms: [...new Set([lt, ...acceptedForms])] });

// The course is authored data. The engine below only combines and schedules it;
// it never asks an AI to invent lesson text or accepted answers at runtime.
const UNIT_BLUEPRINTS = [
  ['sep-01', 'September', 'A1', 'Sounds & first hellos', 'Recognise core Lithuanian sounds and greet someone.', 'Pronunciation and polite register', [p('Labas!', 'Hi!'), p('Laba diena!', 'Good afternoon!'), p('Ačiū.', 'Thank you.'), p('Prašau.', 'Please / you are welcome.')]],
  ['sep-02', 'September', 'A1', 'Introductions & būti', 'Introduce yourself and say where you are from.', 'aš esu, tu esi, jis / ji yra', [p('Aš esu studentas.', 'I am a male student.', ['Esu studentas.']), p('Aš esu studentė.', 'I am a female student.', ['Esu studentė.']), p('Mano vardas yra Tomas.', 'My name is Tomas.', ['Mano vardas Tomas.']), p('Iš kur tu esi?', 'Where are you from?')]],
  ['sep-03', 'September', 'A1', 'Numbers, time & prices', 'Understand basic numbers, times and prices.', 'kiek? kelinta?', [p('Kiek kainuoja?', 'How much does it cost?'), p('Dabar yra trečia valanda.', "It is three o’clock now."), p('Man reikia dviejų bilietų.', 'I need two tickets.'), p('Ar galima kortele?', 'Can I pay by card?')]],
  ['sep-04', 'September', 'A1', 'Café survival', 'Order a drink and respond to a simple café question.', 'noriu + genitive', [p('Norėčiau kavos, prašau.', 'I would like coffee, please.', ['Noriu kavos, prašau.']), p('Ar su pienu?', 'With milk?'), p('Be cukraus, ačiū.', 'Without sugar, thank you.'), p('Čia ar išsinešti?', 'For here or takeaway?')]],
  ['oct-05', 'October', 'A1', 'My daily routine', 'Describe four parts of a normal day.', 'Present tense: -u, -i, -a', [p('Ryte keliuosi septintą.', 'I get up at seven in the morning.'), p('Aš studijuoju universitete.', 'I study at university.'), p('Vakare gaminu vakarienę.', 'In the evening I cook dinner.'), p('Kada tu dirbi?', 'When do you work?')]],
  ['oct-06', 'October', 'A1', 'Food & preferences', 'Say what you eat, drink, like and dislike.', 'Accusative and genitive after negation', [p('Aš valgau sriubą.', 'I eat soup.'), p('Aš nevalgau mėsos.', 'I do not eat meat.'), p('Man patinka juoda duona.', 'I like dark rye bread.'), p('Ko norėtum?', 'What would you like?')]],
  ['oct-07', 'October', 'A1', 'Shopping', 'Ask for an item, size and quantity.', 'Accusative objects; numbers', [p('Ieškau šilto megztinio.', 'I am looking for a warm sweater.'), p('Ar turite mažesnį dydį?', 'Do you have a smaller size?'), p('Duokite pusę kilogramo.', 'Give me half a kilogram.'), p('Aš tik žiūriu.', 'I am just looking.')]],
  ['oct-08', 'October', 'A1', 'Questions that work', 'Form useful everyday questions.', 'kas, kur, kada, kiek, kodėl, kaip', [p('Kur yra tualetas?', 'Where is the toilet?'), p('Kada prasideda paskaita?', 'When does the lecture start?'), p('Kaip nuvykti į centrą?', 'How do I get to the centre?'), p('Kodėl parduotuvė uždaryta?', 'Why is the shop closed?')]],
  ['nov-09', 'November', 'A1', 'Around the city', 'Name places and say where you are going.', 'į + accusative; locative', [p('Einu į biblioteką.', 'I am going to the library.'), p('Esu miesto centre.', 'I am in the city centre.'), p('Vaistinė yra šalia banko.', 'The pharmacy is next to the bank.'), p('Susitinkame stotyje.', 'We are meeting at the station.')]],
  ['nov-10', 'November', 'A1', 'Public transport', 'Buy a ticket and understand a simple route.', 'važiuoti + instrumental', [p('Važiuoju autobusu.', 'I am going by bus.'), p('Kur nusipirkti bilietą?', 'Where can I buy a ticket?'), p('Kita stotelė – Centras.', 'The next stop is Centre.'), p('Ar šis autobusas važiuoja į stotį?', 'Does this bus go to the station?')]],
  ['nov-11', 'November', 'A1', 'Directions', 'Ask for and follow short directions.', 'Imperatives and direction adverbs', [p('Eikite tiesiai.', 'Go straight.'), p('Pasukite į kairę.', 'Turn left.'), p('Tai yra priešais parką.', 'It is opposite the park.'), p('Ar toli nuo čia?', 'Is it far from here?')]],
  ['nov-12', 'November', 'A1', 'Campus requests', 'Find a room and ask for practical help.', 'Polite ar galėtumėte', [p('Kur yra 204 auditorija?', 'Where is room 204?'), p('Ar galėtumėte man padėti?', 'Could you help me?'), p('Man reikia studento pažymėjimo.', 'I need a student card.'), p('Aš nesuprantu užduoties.', 'I do not understand the task.')]],
  ['dec-13', 'December', 'A1', 'Family & people', 'Introduce family and describe relationships.', 'Possessives and genitive', [p('Čia yra mano sesuo.', 'This is my sister.'), p('Mano brolis gyvena Kaune.', 'My brother lives in Kaunas.'), p('Mes dažnai susitinkame.', 'We often meet.'), p('Kiek žmonių yra tavo šeimoje?', 'How many people are in your family?')]],
  ['dec-14', 'December', 'A1', 'Descriptions', 'Describe appearance and personality simply.', 'Adjective agreement', [p('Ji yra draugiška ir rami.', 'She is friendly and calm.'), p('Jis turi trumpus plaukus.', 'He has short hair.'), p('Mano kambarys yra šviesus.', 'My room is bright.'), p('Ši knyga labai įdomi.', 'This book is very interesting.')]],
  ['dec-15', 'December', 'A1', 'Home & housing', 'Describe your room and report a housing issue.', 'Locative and nėra', [p('Gyvenu bendrabutyje.', 'I live in a dormitory.'), p('Virtuvė yra antrame aukšte.', 'The kitchen is on the second floor.'), p('Kambaryje nėra šildymo.', 'There is no heating in the room.'), p('Kada galite sutaisyti?', 'When can you fix it?')]],
  ['dec-16', 'December', 'A1', 'A1 checkpoint', 'Complete familiar transactions and give a short self-introduction.', 'A1 consolidation', [p('Galiu trumpai prisistatyti.', 'I can introduce myself briefly.'), p('Galiu užsisakyti maisto.', 'I can order food.'), p('Galiu paklausti kelio.', 'I can ask for directions.'), p('Prašau kalbėti lėčiau.', 'Please speak more slowly.')]],
  ['jan-17', 'January', 'A2', 'Classes & subjects', 'Discuss classes and what you are learning.', 'Object cases in study contexts', [p('Šį semestrą mokausi lietuvių kalbos.', 'This semester I am learning Lithuanian.'), p('Kuri paskaita tau įdomiausia?', 'Which lecture is most interesting to you?'), p('Turiu perskaityti šį straipsnį.', 'I have to read this article.'), p('Rytoj rašome testą.', 'Tomorrow we are taking a test.')]],
  ['jan-18', 'January', 'A2', 'Schedules & deadlines', 'Negotiate a time and explain a deadline.', 'Time expressions and modal verbs', [p('Užduotį reikia pateikti iki penktadienio.', 'The assignment must be submitted by Friday.'), p('Ar galime susitikti po paskaitos?', 'Can we meet after the lecture?'), p('Man tinka trečiadienis.', 'Wednesday works for me.'), p('Vėluosiu apie dešimt minučių.', 'I will be about ten minutes late.')]],
  ['jan-19', 'January', 'A2', 'Administration', 'Handle common university administration.', 'Formal requests', [p('Norėčiau užsiregistruoti į kursą.', 'I would like to register for the course.'), p('Kur galiu gauti pažymą?', 'Where can I get a certificate?'), p('Trūksta vieno dokumento.', 'One document is missing.'), p('Kada bus paskelbti rezultatai?', 'When will the results be published?')]],
  ['jan-20', 'January', 'A2', 'Permissions & problems', 'Ask permission and explain a study problem.', 'galėti, reikėti, negalėti', [p('Ar galiu išeiti anksčiau?', 'May I leave earlier?'), p('Negalėjau prisijungti prie sistemos.', 'I could not log in to the system.'), p('Man reikia daugiau laiko.', 'I need more time.'), p('Kaip galiu išspręsti šią problemą?', 'How can I solve this problem?')]],
  ['feb-21', 'February', 'A2', 'What happened?', 'Tell a short sequence about yesterday.', 'Past tense', [p('Vakar buvau bibliotekoje.', 'Yesterday I was at the library.'), p('Po to susitikau su draugais.', 'After that I met friends.'), p('Neradau savo rakto.', 'I did not find my key.'), p('Kas atsitiko?', 'What happened?')]],
  ['feb-22', 'February', 'A2', 'Plans & future', 'Talk about near-future plans and arrangements.', 'Future tense', [p('Savaitgalį važiuosiu į Trakus.', 'At the weekend I will go to Trakai.'), p('Kitą savaitę pradėsiu praktiką.', 'Next week I will start an internship.'), p('Ar prisijungsi prie mūsų?', 'Will you join us?'), p('Tikiuosi, kad bus geras oras.', 'I hope the weather will be good.')]],
  ['feb-23', 'February', 'A2', 'Health', 'Explain basic symptoms and understand advice.', 'Body, symptoms and imperatives', [p('Man skauda gerklę.', 'My throat hurts.'), p('Karščiuoju nuo vakar.', 'I have had a fever since yesterday.'), p('Vartokite vaistus du kartus per dieną.', 'Take the medicine twice a day.'), p('Ar reikia užsiregistruoti?', 'Do I need to register?')]],
  ['feb-24', 'February', 'A2', 'Services & repairs', 'Arrange a service and describe what is wrong.', 'Passive-like service phrases', [p('Mano telefonas neveikia.', 'My phone does not work.'), p('Norėčiau užsakyti remontą.', 'I would like to arrange a repair.'), p('Kiek laiko tai užtruks?', 'How long will it take?'), p('Ar gausiu kvitą?', 'Will I receive a receipt?')]],
  ['mar-25', 'March', 'A2', 'Experiences', 'Talk about things you have tried and places visited.', 'Past tense review; jau / dar', [p('Jau lankiausi Klaipėdoje.', 'I have already visited Klaipėda.'), p('Dar nebuvau prie jūros žiemą.', 'I have not yet been to the sea in winter.'), p('Tai buvo puiki patirtis.', 'It was a great experience.'), p('Ar kada nors ragavai cepelinų?', 'Have you ever tried cepelinai?')]],
  ['mar-26', 'March', 'A2', 'Comparisons', 'Compare places, options and routines.', 'Comparative adjectives', [p('Vilnius yra didesnis už Kauną.', 'Vilnius is bigger than Kaunas.'), p('Traukiniu greičiau negu autobusu.', 'By train it is faster than by bus.'), p('Šis variantas pigesnis.', 'This option is cheaper.'), p('Kuris tau patogesnis?', 'Which one is more convenient for you?')]],
  ['mar-27', 'March', 'A2', 'Preferences & reasons', 'Give preferences with simple reasons.', 'nes, todėl, bet', [p('Man labiau patinka pavasaris, nes šviesiau.', 'I prefer spring because it is brighter.'), p('Norėjau eiti, bet buvau pavargęs.', 'I wanted to go, but I was tired.'), p('Lijo, todėl likome namie.', 'It rained, so we stayed at home.'), p('Kodėl taip manai?', 'Why do you think so?')]],
  ['mar-28', 'March', 'A2', 'Connected answers', 'Give a connected 45-second answer.', 'Sequencing: pirmiausia, tada, galiausiai', [p('Pirmiausia nuėjome į muziejų.', 'First we went to the museum.'), p('Tada išgėrėme kavos.', 'Then we had coffee.'), p('Be to, sutikome seną draugą.', 'In addition, we met an old friend.'), p('Galiausiai grįžome namo.', 'Finally we returned home.')]],
  ['apr-29', 'April', 'A2', 'Longer café dialogue', 'Manage an order, clarification and payment.', 'Polite repair strategies', [p('Atsiprašau, užsisakiau arbatą, ne kavą.', 'Excuse me, I ordered tea, not coffee.'), p('Gal galėtumėte pakeisti?', 'Could you change it?'), p('Viskas gerai, ačiū.', 'Everything is fine, thank you.'), p('Sąskaitą, prašau.', 'The bill, please.')]],
  ['apr-30', 'April', 'A2', 'Messages & invitations', 'Write and respond to a short practical message.', 'Informal written register', [p('Labas, ar turi laiko rytoj?', 'Hi, do you have time tomorrow?'), p('Deja, rytoj negaliu.', 'Unfortunately, I cannot tomorrow.'), p('Gal susitinkame šeštadienį?', 'Maybe we can meet on Saturday?'), p('Parašyk, kada tau tinka.', 'Write when it suits you.')]],
  ['apr-31', 'April', 'A2', 'Authentic listening', 'Catch key facts in a short announcement.', 'Listening for time, place and action', [p('Traukinys vėluoja dvidešimt minučių.', 'The train is twenty minutes late.'), p('Prašome eiti į trečią peroną.', 'Please go to platform three.'), p('Registracija baigiasi šeštą valandą.', 'Registration ends at six.'), p('Renginys vyks pagrindinėje salėje.', 'The event will take place in the main hall.')]],
  ['apr-32', 'April', 'A2', 'Solve a problem', 'Explain, clarify and agree on a solution.', 'Clarification and negotiation', [p('Leiskite paaiškinti situaciją.', 'Let me explain the situation.'), p('Ar teisingai supratau?', 'Did I understand correctly?'), p('Ką siūlote daryti?', 'What do you suggest doing?'), p('Toks sprendimas man tinka.', 'That solution works for me.')]],
  ['may-33', 'May', 'A2', 'Mission: arrival day', 'Complete a chain of transport, housing and shopping tasks.', 'Integrated survival language', [p('Ką tik atvykau į Vilnių.', 'I have just arrived in Vilnius.'), p('Turiu rasti savo bendrabutį.', 'I have to find my dormitory.'), p('Kur yra artimiausia parduotuvė?', 'Where is the nearest shop?'), p('Ar galite parodyti žemėlapyje?', 'Can you show me on the map?')]],
  ['may-34', 'May', 'A2', 'Mission: university day', 'Manage a class, administration and a social invitation.', 'Integrated university language', [p('Pirmiausia turiu nueiti į dekanatą.', 'First I have to go to the dean’s office.'), p('Po paskaitos ruošime projektą.', 'After the lecture we will prepare the project.'), p('Ar norėtum prisijungti?', 'Would you like to join?'), p('Pranešiu tau vakare.', 'I will let you know in the evening.')]],
  ['may-35', 'May', 'A2', 'A2 can-do checkpoint', 'Show evidence across familiar real-life situations.', 'A2 consolidation', [p('Galiu paaiškinti, ko man reikia.', 'I can explain what I need.'), p('Galiu papasakoti apie savo patirtį.', 'I can talk about my experience.'), p('Galiu susitarti dėl laiko ir vietos.', 'I can agree on a time and place.'), p('Galiu paprašyti paaiškinti dar kartą.', 'I can ask for another explanation.')]],
  ['may-36', 'May', 'B1 bridge', 'B1 bridge: tell a story', 'Give an optional connected narrative and opinion.', 'B1 connectors and viewpoint', [p('Mano nuomone, gyvenimas užsienyje daug ko išmoko.', 'In my opinion, living abroad teaches you a lot.'), p('Nors pradžioje buvo sunku, vėliau pripratau.', 'Although it was difficult at first, later I got used to it.'), p('Svarbiausia buvo nebijoti kalbėti.', 'The most important thing was not being afraid to speak.'), p('Jeigu turėčiau daugiau laiko, keliaučiau po Lietuvą.', 'If I had more time, I would travel around Lithuania.')]]
];

export const PATH_STAGES = Object.freeze([
  { id: 'stage-1', number: 1, unitStart: 1, unitEnd: 4, title: 'Survival Lithuanian', subtitle: 'Sounds, introductions, time and café language', color: 'green' },
  { id: 'stage-2', number: 2, unitStart: 5, unitEnd: 8, title: 'Everyday essentials', subtitle: 'Routines, food, shopping and useful questions', color: 'orange' },
  { id: 'stage-3', number: 3, unitStart: 9, unitEnd: 12, title: 'Move around with confidence', subtitle: 'City, transport, directions and campus', color: 'blue' },
  { id: 'stage-4', number: 4, unitStart: 13, unitEnd: 16, title: 'Your A1 checkpoint', subtitle: 'People, home and familiar transactions', color: 'purple' },
  { id: 'stage-5', number: 5, unitStart: 17, unitEnd: 20, title: 'University life', subtitle: 'Classes, schedules, administration and problems', color: 'green' },
  { id: 'stage-6', number: 6, unitStart: 21, unitEnd: 24, title: 'Talk across time', subtitle: 'Past, future, health and services', color: 'orange' },
  { id: 'stage-7', number: 7, unitStart: 25, unitEnd: 28, title: 'Connect your ideas', subtitle: 'Experience, comparisons, reasons and stories', color: 'blue' },
  { id: 'stage-8', number: 8, unitStart: 29, unitEnd: 32, title: 'Longer real conversations', subtitle: 'Dialogue, messages, listening and problem-solving', color: 'purple' },
  { id: 'stage-9', number: 9, unitStart: 33, unitEnd: 36, title: 'Real-life missions', subtitle: 'A2 evidence and an optional B1 bridge', color: 'green' }
]);

const SESSION_KINDS = ['pattern', 'vocabulary', 'listening', 'dialogue', 'practice', 'mission'];
const SESSION_ICONS = ['fa-shapes', 'fa-book-open', 'fa-headphones', 'fa-comments', 'fa-dumbbell', 'fa-location-dot'];

function shuffleOrder(words, offset) {
  const rotated = [...words.slice(offset), ...words.slice(0, offset)];
  return rotated;
}

function makeExercises(unit, sessionIndex) {
  const types = sessionIndex === 0
    ? ['pattern', 'meaning-choice', 'word-order', 'cloze', 'listening-choice', 'read-repeat']
    : sessionIndex === 1
      ? ['matching', 'typed-recall', 'dictation', 'cloze', 'word-order', 'listening-choice']
      : sessionIndex === 2
        ? ['listening-choice', 'dictation', 'meaning-choice', 'read-repeat', 'matching', 'typed-recall']
        : sessionIndex === 3
          ? ['dialogue', 'listening-choice', 'matching', 'word-order', 'typed-recall', 'read-repeat']
          : sessionIndex === 4
            ? ['matching', 'cloze', 'word-order', 'dictation', 'typed-recall', 'role-play']
            : ['mission', 'meaning-choice', 'cloze', 'dictation', 'matching', 'role-play'];
  return types.map((type, exerciseIndex) => {
    const focusIndex = (sessionIndex + exerciseIndex) % unit.phrases.length;
    const focus = unit.phrases[focusIndex];
    const second = unit.phrases[(focusIndex + 1) % unit.phrases.length];
    const words = focus.lt.replace(/[?!.,–]/g, '').split(/\s+/);
    const clozeIndex = Math.min(1, words.length - 1);
    const clozeAnswer = words[clozeIndex];
    const clozePrompt = focus.lt.replace(clozeAnswer, '_____');
    const distractors = unit.phrases.filter(item => item.lt !== focus.lt).map(item => item.en);
    return {
      id: `${unit.id}-s${sessionIndex + 1}-e${exerciseIndex + 1}`,
      type,
      prompt: type === 'pattern' ? unit.grammar
        : type === 'meaning-choice' ? `What does “${focus.lt}” mean?`
          : type === 'word-order' ? `Build: ${focus.en}`
            : type === 'cloze' ? 'Complete the Lithuanian phrase.'
              : type === 'listening-choice' ? 'Listen and choose the meaning.'
                : type === 'dictation' ? 'Listen and type what you hear.'
                  : type === 'matching' ? 'Match each phrase with its meaning.'
                    : type === 'dialogue' ? `Write this reply in Lithuanian: ${focus.en}`
                      : type === 'mission' ? `Complete this mission step: ${focus.en}`
                        : type === 'role-play' ? `Say this naturally: ${focus.en}`
                          : type === 'read-repeat' ? 'Listen, then say the phrase aloud.'
                            : `Translate into Lithuanian: ${focus.en}`,
      instruction: type === 'pattern' ? 'Notice the useful form, then continue to active practice.'
        : type === 'cloze' ? 'Use the English cue to identify the missing Lithuanian word.' : '',
      phrase: focus,
      secondaryPhrase: second,
      matchPairs: type === 'matching'
        ? [focus, second].map((phrase, pairIndex) => ({ ...phrase, key: `${unit.id}-${sessionIndex}-${exerciseIndex}-${pairIndex}` }))
        : [],
      audioText: ['listening-choice', 'dictation', 'read-repeat', 'role-play'].includes(type) ? focus.lt : '',
      choices: type === 'meaning-choice' || type === 'listening-choice'
        ? shuffleOrder([focus.en, ...distractors.slice(0, 3)], (sessionIndex + exerciseIndex) % unit.phrases.length)
        : [],
      tokens: type === 'word-order' ? shuffleOrder(words, (sessionIndex + exerciseIndex + 1) % Math.max(1, words.length)) : [],
      acceptedAnswers: type === 'cloze' ? [...new Set([clozeAnswer, ...focus.acceptedForms])] : focus.acceptedForms,
      clozeAnswer: type === 'cloze' ? clozeAnswer : '',
      clozePrompt: type === 'cloze' ? clozePrompt : '',
      answer: focus.lt,
      outcomeTag: unit.outcome,
      rescue: focus.en
    };
  });
}

export const LITHUANIAN_UNITS = Object.freeze(UNIT_BLUEPRINTS.map((row, unitIndex) => {
  const [id, , cefr, title, outcome, grammar, phrases] = row;
  const unit = { id, unitNumber: unitIndex + 1, sectionNumber: Math.floor(unitIndex / 4) + 1, cefr, title, outcome, grammar, phrases };
  return Object.freeze({
    ...unit,
    sessions: Object.freeze(SESSION_KINDS.map((kind, sessionIndex) => Object.freeze({
      id: `${id}-s${sessionIndex + 1}`,
      unitId: id,
      unitNumber: unitIndex + 1,
      sessionNumber: sessionIndex + 1,
      kind,
      icon: SESSION_ICONS[sessionIndex],
      title: sessionIndex === 0 ? title
        : sessionIndex === 1 ? 'Words in context'
          : sessionIndex === 2 ? 'Listening lab'
            : sessionIndex === 3 ? 'Guided dialogue'
              : sessionIndex === 4 ? 'Mixed review'
                : 'Module mission',
      durationMinutes: sessionIndex >= 3 ? 9 : 7,
      exercises: Object.freeze(makeExercises(unit, sessionIndex))
    })))
  });
}));

export const LITHUANIAN_SESSIONS = Object.freeze(LITHUANIAN_UNITS.flatMap(unit => unit.sessions));

export function getLithuanianUnit(unitId) {
  return LITHUANIAN_UNITS.find(unit => unit.id === unitId) || null;
}

export function getLithuanianSession(sessionId) {
  return LITHUANIAN_SESSIONS.find(session => session.id === sessionId) || null;
}

export function validateLithuanianCurriculum() {
  const errors = [];
  const ids = new Set();
  if (LITHUANIAN_UNITS.length !== 36) errors.push('The path must contain 36 units.');
  for (const unit of LITHUANIAN_UNITS) {
    if (unit.sessions.length !== 6) errors.push(`${unit.id} must contain six lessons.`);
    for (const session of unit.sessions) {
      if (ids.has(session.id)) errors.push(`Duplicate session ID: ${session.id}`);
      ids.add(session.id);
      if (session.exercises.length < 5 || session.exercises.length > 7) errors.push(`${session.id} must contain 5–7 exercises.`);
      for (const exercise of session.exercises) {
        if (!exercise.answer || !exercise.phrase?.en || !exercise.outcomeTag) errors.push(`${exercise.id} is incomplete.`);
        if (!exercise.acceptedAnswers?.length) errors.push(`${exercise.id} has no accepted Lithuanian form.`);
        if (exercise.type === 'cloze' && !exercise.acceptedAnswers.includes(exercise.clozeAnswer)) errors.push(`${exercise.id} does not accept its missing word.`);
        if (exercise.type === 'matching' && exercise.matchPairs?.length < 2) errors.push(`${exercise.id} needs at least two real pairs.`);
      }
    }
  }
  return errors;
}
