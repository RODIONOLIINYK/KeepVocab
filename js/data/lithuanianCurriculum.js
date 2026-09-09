import { buildFormExercise, FORM_TOPICS } from './lithuanianForms.js?v=1602';
const p = (lt, en, acceptedForms = []) => ({ lt, en, acceptedForms: [...new Set([lt, ...acceptedForms])] });

// The course is authored data. The engine below only combines and schedules it;
// core lessons work offline; optional AI activities have authored fallbacks.
const UNIT_BLUEPRINTS = [
  ['sep-01', 'September', 'A1', 'Lithuanian alphabet & sounds', 'Read all 32 letters and pronounce the special Lithuanian characters.', '32 letters; ą č ę ė į š ų ū ž', [p('Ačiū.', 'Thank you.'), p('Šeima.', 'Family.'), p('Žodis.', 'A word.'), p('Lietuvių kalba.', 'The Lithuanian language.')]],
  ['sep-02', 'September', 'A1', 'Pronouns & būti (“to be”)', 'Use every present-tense form of “to be” in a basic introduction.', 'aš esu, tu esi, jis / ji yra, mes esame, jūs esate, jie / jos yra', [p('Aš esu studentas.', 'I am a male student.', ['Esu studentas.']), p('Tu esi studentė.', 'You are a female student.', ['Esi studentė.']), p('Mes esame iš Lenkijos.', 'We are from Poland.', ['Esame iš Lenkijos.']), p('Jie yra Vilniuje.', 'They are in Vilnius.')]],
  ['sep-03', 'September', 'A1', 'Noun gender & base endings', 'Recognise common masculine and feminine noun endings.', 'masculine: -as, -is, -ys, -us; feminine: -a, -ė, -is', [p('Tai yra stalas.', 'This is a table.'), p('Tai yra knyga.', 'This is a book.'), p('Studentas yra naujas.', 'The male student is new.'), p('Studentė yra nauja.', 'The female student is new.')]],
  ['sep-04', 'September', 'A1', 'Present-tense verb endings', 'Build a regular present-tense sentence with each basic person.', 'aš -u, tu -i, jis / ji -a; mes -ame, jūs -ate', [p('Aš dirbu.', 'I work.'), p('Tu dirbi.', 'You work.'), p('Ji dirba.', 'She works.'), p('Mes dirbame.', 'We work.')]],
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

const g = (summary, rule, forms, tip, alphabet = []) => ({ summary, rule, forms, tip, alphabet });

// Every module has an explicit, authored grammar page. It is reused at the start
// of each lesson in that module so recognition, listening and speaking never turn
// into context-free quizzing.
const GRAMMAR_GUIDES = [
  g('Lithuanian uses a 32-letter Latin alphabet. Q, W and X appear only in foreign names and words.', 'Long vowels and diacritics can distinguish words. Learn ą, č, ę, ė, į, š, ų, ū and ž as letters in their own right.', [
    ['Vowels', 'a ą e ę ė i į y o u ų ū', 'ą, ę, į, ų and ū are normally long; y is a long i sound'],
    ['Special consonants', 'č · š · ž', 'roughly ch in chair · sh in ship · s in measure'],
    ['Common contrasts', 'i / y · u / ū · e / ė', 'short and long or differently placed vowel sounds']
  ], 'Say the letter groups aloud, then look for the diacritic before guessing a word.', ['A Ą B C Č', 'D E Ę Ė F G', 'H I Į Y J K', 'L M N O P R', 'S Š T U Ų Ū', 'V Z Ž']),
  g('Lithuanian “to be” is būti. Its present forms are irregular, so learn them as one six-part set.', 'Pronouns may be omitted when the verb already makes the person clear: Aš esu studentas → Esu studentas.', [
    ['I / you', 'aš esu · tu esi', 'I am · you are (singular informal)'],
    ['he, she / we', 'jis, ji yra · mes esame', 'he, she is · we are'],
    ['you / they', 'jūs esate · jie, jos yra', 'you are (plural or polite) · they are']
  ], 'Yra is used for both singular and plural third person. Esu and esi are the two shortest forms.'),
  g('A noun’s dictionary ending often signals its gender and predicts how it changes in a sentence.', 'Most nouns in -as, -is, -ys and -us are masculine; most in -a and -ė are feminine. A smaller group ending in -is is feminine, so learn those with their gender.', [
    ['Masculine', '-as · -is · -ys · -us', 'stalas, brolis, kambarys, sūnus'],
    ['Feminine', '-a · -ė', 'knyga, gatvė'],
    ['Feminine exception', '-is', 'moteris, pilis']
  ], 'Store a noun with its final two letters. The ending is grammatical information, not decoration.'),
  g('Present-tense verbs change their ending to show who performs the action.', 'Start from the third-person present form, remove its final -a, -i or -o, then attach the person ending used by that conjugation.', [
    ['Singular model', 'aš dirbu · tu dirbi · jis/ji dirba', 'I work · you work · he/she works'],
    ['Plural model', 'mes dirbame · jūs dirbate', 'we work · you work'],
    ['Third person', 'jie/jos dirba', 'they work; same form as he/she']
  ], 'Lithuanian has no separate “I am working” tense: dirbu can mean “I work” or “I am working”.'),
  g('Daily-routine verbs let you practise the three common present-tense stem classes: -a, -i and -o.', 'The third-person form reveals the class: dirba, turi, studijuoja. The aš and tu endings then change with that stem.', [
    ['-a class', 'dirbu · dirbi · dirba', 'work'],
    ['-i class', 'turiu · turi · turi', 'have'],
    ['-o class', 'studijuoju · studijuoji · studijuoja', 'study']
  ], 'Always learn an infinitive together with its third-person present form: dirbti — dirba.'),
  g('A direct object normally uses the accusative. After a negated verb, Lithuanian normally switches that object to the genitive.', 'Common singular changes include -as → -ą, -is → -į, -a → -ą and -ė → -ę. With ne-, use a genitive form instead.', [
    ['Affirmative', 'valgau sriubą', 'I eat soup (accusative)'],
    ['Negative', 'nevalgau mėsos', 'I do not eat meat (genitive)'],
    ['Verb contrast', 'noriu kavos', 'I want coffee; norėti also governs genitive']
  ], 'Ask “what is affected?” for the accusative, then check whether negation or the verb requires genitive.'),
  g('Adjectives copy the noun’s gender, number and case, so both words often change together.', 'In the masculine accusative singular, -as often becomes -ą; feminine -a also becomes -ą. Genitive adjective endings change too.', [
    ['Base', 'šiltas megztinis · šilta striukė', 'a warm sweater · a warm jacket'],
    ['Accusative', 'šiltą megztinį · šiltą striukę', 'a warm sweater/jacket as object'],
    ['Genitive', 'šilto megztinio', 'of a warm sweater']
  ], 'Treat adjective + noun as a pair: changing the noun alone leaves the phrase unfinished.'),
  g('Questions keep ordinary sentence structure and add a question word or the yes/no marker ar.', 'Kas asks who/what, kur where, kada when, kiek how much/many, kodėl why and kaip how. Ar begins a neutral yes/no question.', [
    ['Place / time', 'kur? · kada?', 'where? · when?'],
    ['Reason / manner', 'kodėl? · kaip?', 'why? · how?'],
    ['Yes/no', 'Ar tu dirbi?', 'Do you work?']
  ], 'Do not copy English do/does. Lithuanian asks Ar tu dirbi?, not a sentence with an extra helper verb.'),
  g('Lithuanian distinguishes movement into a place from being inside a place.', 'Use į + accusative for destination. Use the locative case, often -e, -oje or -ėje, for location.', [
    ['Destination', 'einu į biblioteką', 'I am going to the library'],
    ['Location', 'esu bibliotekoje', 'I am in the library'],
    ['City', 'į Vilnių · Vilniuje', 'to Vilnius · in Vilnius']
  ], 'Movement answers kur? with į + object; location answers kur? with a locative ending.'),
  g('The instrumental expresses means or accompaniment and is common with transport.', 'Singular endings often become masculine -u / -iu and feminine -a / -e. With a person, use su + instrumental.', [
    ['Transport', 'važiuoju autobusu', 'I travel by bus'],
    ['Accompaniment', 'su draugu · su drauge', 'with a male friend · with a female friend'],
    ['Plural', 'su draugais', 'with friends']
  ], 'If English says by bus or with a friend, check for the instrumental.'),
  g('Commands have informal singular, informal plural and polite plural forms.', 'For many verbs, build the imperative from the infinitive stem with -k, -kite or -kime.', [
    ['Informal', 'eik · pasuk', 'go · turn (to one familiar person)'],
    ['Polite / plural', 'eikite · pasukite', 'go · turn'],
    ['Let’s', 'eikime', 'let us go']
  ], 'Use -kite with strangers and staff; it is both polite singular and ordinary plural.'),
  g('Modal and impersonal verbs are followed by an infinitive ending in -ti.', 'Galiu expresses ability or permission. Reikia means “it is necessary / I need to”. Galėtumėte makes a polite request.', [
    ['Ability', 'galiu padėti', 'I can help'],
    ['Need', 'man reikia eiti', 'I need to go'],
    ['Polite request', 'Ar galėtumėte paaiškinti?', 'Could you explain?']
  ], 'Only the modal verb changes for person; the following infinitive stays in -ti.'),
  g('Possession uses possessive words or the genitive. Mano and tavo do not change for case or gender.', 'A possessor noun changes to genitive: brolio “brother’s”, sesers “sister’s”. The possessed noun keeps the form required by the sentence.', [
    ['Pronouns', 'mano · tavo · jo · jos', 'my · your · his · her'],
    ['Noun possessor', 'brolio knyga', 'the brother’s book'],
    ['Question', 'Kieno knyga?', 'Whose book?']
  ], 'Lithuanian has no apostrophe-s. Put the owner in genitive before the thing owned.'),
  g('Adjective endings must agree with masculine/feminine and singular/plural nouns.', 'A common nominative pattern is masculine -as, feminine -a, masculine plural -i and feminine plural -os.', [
    ['Singular', 'draugiškas vyras · draugiška moteris', 'friendly man · friendly woman'],
    ['Plural', 'draugiški vyrai · draugiškos moterys', 'friendly men · friendly women'],
    ['Neuter adverb', 'čia šviesu', 'it is bright here']
  ], 'Find the noun first; its gender, number and case choose the adjective ending.'),
  g('Plural noun endings depend on the noun class and then change again across cases.', 'Learn the nominative plural with each noun. Common patterns include -as → -ai, -is → -iai and -a → -os.', [
    ['Masculine', 'studentas → studentai', 'student → students'],
    ['Feminine', 'knyga → knygos', 'book → books'],
    ['Locative plural', 'kambariuose', 'in the rooms']
  ], 'Do not add one universal plural suffix. Store singular and nominative plural together.'),
  g('The A1 checkpoint combines sounds, būti, present verbs, gender agreement and the core cases.', 'Choose an ending by asking three questions: what role does the word play, is it singular/plural, and what gender/class is it?', [
    ['Identity', 'Esu studentė.', 'būti + nominative'],
    ['Object', 'Užsisakau kavą.', 'accusative'],
    ['Place', 'Esu kavinėje.', 'locative']
  ], 'Explain the ending you chose. A correct form you can explain is more durable than a memorised phrase.'),
  g('Reflexive verbs contain -si- or -s and often describe actions directed back at the subject.', 'The reflexive marker appears before a prefix but at the end of an unprefixed verb: mokytis, mokausi; prisijungti, prisijungiu.', [
    ['Infinitive', 'mokytis', 'to learn / study'],
    ['Present', 'mokausi · mokaisi · mokosi', 'I · you · he/she studies'],
    ['Prefixed', 'užsiregistruoti', 'to register oneself']
  ], 'Learn reflexive verbs as complete dictionary forms; do not remove -si as if it were optional.'),
  g('Time expressions use several cases and prepositions; the chosen form marks before, after, until or duration.', 'Po usually takes genitive, iki takes genitive, and clock time often uses an ordinal accusative form.', [
    ['After / until', 'po paskaitos · iki penktadienio', 'after class · until Friday'],
    ['At a time', 'trečią valandą', 'at three o’clock'],
    ['Duration', 'dešimt minučių', 'ten minutes']
  ], 'Learn the preposition together with the case it controls.'),
  g('Formal Lithuanian uses jūs and plural verb forms for one person as well as many people.', 'Polite requests often use norėčiau “I would like”, galėčiau “could I” or the conditional galėtumėte “could you”.', [
    ['Neutral formal', 'Ar galite padėti?', 'Can you help?'],
    ['Softer', 'Ar galėtumėte padėti?', 'Could you help?'],
    ['Service request', 'Norėčiau užsiregistruoti.', 'I would like to register.']
  ], 'Choose tu only for familiar singular relationships; use jūs by default with strangers.'),
  g('Negation uses ne- directly on the verb. The object of a negated transitive verb normally changes from accusative to genitive.', 'Modal verbs keep the negative prefix too: galiu → negaliu; galėjau → negalėjau.', [
    ['Present', 'galiu · negaliu', 'I can · I cannot'],
    ['Past', 'galėjau · negalėjau', 'I could · I could not'],
    ['Object shift', 'turiu laiko · neturiu laiko', 'I have time · I do not have time']
  ], 'When you add ne-, inspect the object ending as well as the verb.'),
  g('The simple past describes a completed or bounded past event. Its endings attach to a past stem.', 'A common pattern is aš -au, tu -ai, third person -o or -ė, mes -ome/-ėme and jūs -ote/-ėte.', [
    ['būti', 'buvau · buvai · buvo', 'was / were'],
    ['eiti', 'ėjau · ėjai · ėjo', 'went'],
    ['dirbti', 'dirbau · dirbai · dirbo', 'worked']
  ], 'Learn infinitive, third-person present and third-person past together: eiti — eina — ėjo.'),
  g('The past frequentative describes what used to happen repeatedly. Lithuanian marks it with -dav-.', 'Use the infinitive stem + -dav- + past endings: dirbti → dirbdavau, eiti → eidavau.', [
    ['Singular', 'dirbdavau · dirbdavai · dirbdavo', 'I · you · he/she used to work'],
    ['Plural', 'dirbdavome · dirbdavote', 'we · you used to work'],
    ['Contrast', 'vakar dirbau · kasdien dirbdavau', 'worked yesterday · used to work daily']
  ], 'Use the frequentative for a repeated habit, not for one completed event.'),
  g('The future normally uses the infinitive stem plus -s- and person endings.', 'Drop infinitive -ti, add -s-, then add endings: dirbti → dirbsiu. Some stems change, so learn frequent forms such as būti → būsiu / bus.', [
    ['Singular', 'dirbsiu · dirbsi · dirbs', 'I · you · he/she will work'],
    ['Plural', 'dirbsime · dirbsite · dirbs', 'we · you · they will work'],
    ['būti', 'būsiu · būsi · bus', 'will be']
  ], 'Third-person future has no final personal ending: jis dirbs, jie dirbs.'),
  g('Tense choice tells whether an action is current, completed, habitual in the past or expected later.', 'Time words support the form but do not replace it: dabar + present, vakar + past, anksčiau + frequentative, rytoj + future.', [
    ['Present', 'telefonas neveikia', 'the phone does not work'],
    ['Past', 'telefonas neveikė', 'the phone did not work'],
    ['Future', 'telefonas neveiks', 'the phone will not work']
  ], 'Build a four-column verb card: present, past, past frequentative, future.'),
  g('Lithuanian past forms cover both English simple past and present perfect meanings.', 'Jau “already” and dar “yet/still” help show the speaker’s viewpoint; the verb remains a Lithuanian past form.', [
    ['Completed', 'lankiausi Klaipėdoje', 'I visited / have visited Klaipėda'],
    ['Already', 'jau buvau', 'I have already been'],
    ['Not yet', 'dar nebuvau', 'I have not been yet']
  ], 'Do not search for a separate Lithuanian present-perfect auxiliary; context carries the distinction.'),
  g('Comparatives commonly add -esnis/-esnė to adjectives and -iau to adverbs.', 'Use už + accusative or negu to introduce the comparison.', [
    ['Adjective', 'didelis → didesnis', 'big → bigger'],
    ['Adverb', 'greitai → greičiau', 'quickly → more quickly'],
    ['Comparison', 'didesnis už Kauną', 'bigger than Kaunas']
  ], 'Match -esnis or -esnė to the noun; use -iau when describing how an action happens.'),
  g('Connectors join clauses and show the relationship between ideas.', 'Nes gives a reason, todėl gives a result, bet contrasts ideas, and kad introduces many reported or desired clauses.', [
    ['Reason', 'nes', 'because'],
    ['Result', 'todėl', 'therefore / so'],
    ['Contrast', 'bet', 'but']
  ], 'Choose the logical relationship before choosing the connector.'),
  g('Sequencing words organise a connected answer without changing the normal verb forms.', 'Use pirmiausia, tada, po to and galiausiai at the start of clauses; be to adds another point.', [
    ['Start', 'pirmiausia', 'first'],
    ['Middle', 'tada · po to · be to', 'then · after that · in addition'],
    ['End', 'galiausiai', 'finally']
  ], 'Give each event one finite verb; connectors then make the timeline easy to follow.'),
  g('Polite repair language uses the conditional to soften corrections and requests.', 'Norėčiau and gal galėtumėte are conditional forms. They present a wish or request less directly than present tense.', [
    ['Order', 'Norėčiau arbatos.', 'I would like tea.'],
    ['Repair', 'Gal galėtumėte pakeisti?', 'Could you perhaps change it?'],
    ['Contrast', 'arbatą, ne kavą', 'tea, not coffee']
  ], 'State the problem briefly, make one conditional request, then confirm the solution.'),
  g('Informal messages often omit pronouns because the verb ending already identifies the speaker.', 'Use tu-forms with friends, concise time expressions, and the imperative for a clear next step.', [
    ['Invitation', 'Ar turi laiko?', 'Do you have time?'],
    ['Suggestion', 'Gal susitinkame?', 'Maybe we can meet?'],
    ['Request', 'Parašyk.', 'Write / message me.']
  ], 'A natural short message needs greeting, purpose, concrete proposal and response request.'),
  g('Listening for endings helps identify person, tense and case even when individual sounds are fast.', 'First catch anchors such as time and place; then use endings to decide who acts and when.', [
    ['Future', 'vyks · baigsis', 'will take place · will end'],
    ['Imperative', 'eikite', 'go (polite/plural)'],
    ['Locative', 'salėje', 'in the hall']
  ], 'On the first listen, write only time, place and action. Confirm endings on the second.'),
  g('Clarification questions check meaning without restarting the whole conversation.', 'Ar teisingai supratau, kad…? introduces your interpretation. Ką siūlote daryti? requests a solution.', [
    ['Check', 'Ar teisingai supratau?', 'Did I understand correctly?'],
    ['Explain', 'Leiskite paaiškinti.', 'Let me explain.'],
    ['Agree', 'Man tinka.', 'That works for me.']
  ], 'Use the sequence: explain → check → propose → agree.'),
  g('Integrated tasks require choosing cases and tenses from meaning, not from a single prompt.', 'Destinations take į + accusative, locations take locative, and immediate needs often use turiu + infinitive.', [
    ['Arrival', 'atvykau į Vilnių', 'I arrived in Vilnius'],
    ['Need', 'turiu rasti', 'I have to find'],
    ['Location question', 'Kur yra…?', 'Where is…?']
  ], 'Before speaking, identify destination, current location and next required action.'),
  g('A connected day plan moves accurately between present needs, future arrangements and polite invitations.', 'Use turiu + infinitive for obligations and the future for later actions. Use norėtum for a softened invitation.', [
    ['Obligation', 'turiu nueiti', 'I have to go'],
    ['Future', 'ruošime · pranešiu', 'we will prepare · I will let you know'],
    ['Invitation', 'Ar norėtum prisijungti?', 'Would you like to join?']
  ], 'Make the time line explicit: first, after class, in the evening.'),
  g('A2 control means selecting familiar grammar while concentrating on the real-world goal.', 'Demonstrate present, past and future, at least four core cases, agreement, polite requests and connected clauses.', [
    ['Need', 'ko man reikia', 'what I need; genitive'],
    ['Past account', 'papasakoti apie patirtį', 'talk about an experience'],
    ['Arrangement', 'susitarti dėl laiko', 'agree on a time']
  ], 'After each answer, name one verb form and one noun ending you controlled.'),
  g('The B1 bridge combines connectors, viewpoint phrases and the conditional for imagined situations.', 'Nors introduces concession, mano nuomone frames an opinion, and jeigu + conditional describes a hypothetical.', [
    ['Opinion', 'mano nuomone', 'in my opinion'],
    ['Concession', 'nors…', 'although…'],
    ['Hypothetical', 'jeigu turėčiau, keliaučiau', 'if I had, I would travel']
  ], 'Build a four-part response: position, reason, contrast and hypothetical example.')
];


// CEFR action-oriented outcomes and VDU A1 topic progression inform this sequence.
// See docs/lithuanian-curriculum.md for scope, assessment and source references.
const COURSE_ORDER = [0, 1, 2, 12, 3, 7, 4, 5, 6, 14, 8, 9, 10, 13, 11, 15,
  20, 21, 16, 17, 18, 19, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35];
const FOUNDATION_PHRASES = {
  'sep-01': [p('Labas.', 'Hello.'), p('Ačiū.', 'Thank you.'), p('Prašau.', 'Please. / You are welcome.'), p('Iki.', 'See you.'), p('Taip.', 'Yes.'), p('Ne.', 'No.'), p('Laba diena.', 'Good afternoon.'), p('Viso gero.', 'Goodbye.')],
  'sep-02': [p('Aš esu studentas.', 'I am a male student.', ['Esu studentas.']), p('Tu esi studentė.', 'You are a female student.', ['Esi studentė.']), p('Ji yra mokytoja.', 'She is a teacher.'), p('Jis yra studentas.', 'He is a student.'), p('Mes esame studentai.', 'We are students.'), p('Jūs esate mokytoja.', 'You are a female teacher. (polite)'), p('Jie yra studentai.', 'They are male students.'), p('Mano vardas Jonas.', 'My name is Jonas.')],
  'sep-03': [p('Tai yra stalas.', 'This is a table.'), p('Tai yra knyga.', 'This is a book.'), p('Čia yra kambarys.', 'Here is a room.'), p('Čia yra gatvė.', 'Here is a street.'), p('Tai yra brolis.', 'This is a brother.'), p('Tai yra sesuo.', 'This is a sister.'), p('Vienas stalas.', 'One table.'), p('Dvi knygos.', 'Two books.')],
  'dec-13': [p('Čia yra mano sesuo.', 'This is my sister.'), p('Čia yra mano brolis.', 'This is my brother.'), p('Mano mama yra mokytoja.', 'My mother is a teacher.'), p('Mano tėtis yra gydytojas.', 'My father is a doctor.'), p('Tai yra tavo šeima.', 'This is your family.'), p('Tai yra mano draugas.', 'This is my male friend.'), p('Mano sesers vardas Rasa.', 'My sister’s name is Rasa.'), p('Ar tai tavo brolis?', 'Is this your brother?')],
  'sep-04': [p('Aš dirbu.', 'I work.'), p('Tu dirbi.', 'You work.'), p('Ji dirba.', 'She works.'), p('Mes dirbame.', 'We work.'), p('Jūs dirbate.', 'You work. (plural or polite)'), p('Jie dirba.', 'They work.'), p('Aš gyvenu Vilniuje.', 'I live in Vilnius.'), p('Kur tu gyveni?', 'Where do you live?')],
  'oct-08': [p('Kas čia?', 'What is this?'), p('Kur yra knyga?', 'Where is the book?'), p('Kaip sekasi?', 'How are you?'), p('Ar tu dirbi?', 'Do you work?'), p('Kada tu dirbi?', 'When do you work?'), p('Kiek kainuoja?', 'How much does it cost?'), p('Kodėl?', 'Why?'), p('Ar supranti?', 'Do you understand?')],
  'oct-05': [p('Aš turiu laiko.', 'I have time.'), p('Aš studijuoju.', 'I study.'), p('Ryte dirbu.', 'I work in the morning.'), p('Vakare skaitau.', 'I read in the evening.'), p('Dabar yra septynios.', 'It is seven o’clock now.'), p('Dirbu nuo devynių.', 'I work from nine.'), p('Šiandien yra pirmadienis.', 'Today is Monday.'), p('Rytoj yra antradienis.', 'Tomorrow is Tuesday.')],
  'oct-06': [p('Aš valgau sriubą.', 'I eat soup.'), p('Aš geriu vandenį.', 'I drink water.'), p('Aš nevalgau mėsos.', 'I do not eat meat.'), p('Noriu kavos.', 'I want coffee.'), p('Arbatos, prašau.', 'Tea, please.'), p('Man patinka duona.', 'I like bread.'), p('Sąskaitą, prašau.', 'The bill, please.'), p('Ačiū, labai skanu.', 'Thank you, it is very tasty.')],
  'oct-07': [p('Perku šiltą megztinį.', 'I am buying a warm sweater.'), p('Perku šiltą striukę.', 'I am buying a warm jacket.'), p('Ieškau šilto megztinio.', 'I am looking for a warm sweater.'), p('Kiek kainuoja?', 'How much does it cost?'), p('Tai kainuoja dešimt eurų.', 'It costs ten euros.'), p('Du obuoliai, prašau.', 'Two apples, please.'), p('Ar galima mokėti kortele?', 'Can I pay by card?'), p('Aš tik žiūriu.', 'I am just looking.')]
};
// Match the tense guide to the actual module: future precedes deadlines;
// repeated past habits belong with experiences, not health.
const frequentativeGuide = GRAMMAR_GUIDES[21];
GRAMMAR_GUIDES[21] = GRAMMAR_GUIDES[22];
GRAMMAR_GUIDES[22] = g('Use man with a symptom to explain how you feel.', 'Skauda describes pain; the body part uses the accusative in the pattern man skauda gerklę. Use nuo + genitive to say when it started.', [['Pain', 'Man skauda gerklę.', 'My throat hurts.'], ['Since', 'nuo vakar', 'since yesterday'], ['Advice', 'Vartokite vaistus.', 'Take the medicine. (polite)']], 'Learn the whole pattern man skauda + body part.');
GRAMMAR_GUIDES[24] = frequentativeGuide;
UNIT_BLUEPRINTS[24][3] = 'Experiences & past habits';
UNIT_BLUEPRINTS[24][5] = 'Simple past and past frequentative';
UNIT_BLUEPRINTS[24][6] = [p('Jau lankiausi Klaipėdoje.', 'I have already visited Klaipėda.'), p('Anksčiau gyvenau Kaune.', 'I used to live in Kaunas.'), p('Kasdien eidavau į parką.', 'I used to go to the park every day.'), p('Vakar nuėjau į parką.', 'Yesterday I went to the park.')];

export const PATH_STAGES = Object.freeze([
  { id: 'stage-1', number: 1, unitStart: 1, unitEnd: 4, title: 'Build the foundations', subtitle: 'Sounds, greetings, introductions and family', color: 'green' },
  { id: 'stage-2', number: 2, unitStart: 5, unitEnd: 8, title: 'Build correct sentences', subtitle: 'Present verbs, questions, daily routines and food', color: 'orange' },
  { id: 'stage-3', number: 3, unitStart: 9, unitEnd: 12, title: 'Everyday essentials', subtitle: 'Shopping, home, city and transport', color: 'blue' },
  { id: 'stage-4', number: 4, unitStart: 13, unitEnd: 16, title: 'Your A1 checkpoint', subtitle: 'Directions, descriptions, requests and review', color: 'purple' },
  { id: 'stage-5', number: 5, unitStart: 17, unitEnd: 20, title: 'Talk across time', subtitle: 'Past events, future plans, classes and schedules', color: 'green' },
  { id: 'stage-6', number: 6, unitStart: 21, unitEnd: 24, title: 'Handle everyday problems', subtitle: 'Administration, permission, health and repairs', color: 'orange' },
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

function phraseTokens(value) {
  return [...String(value || '').matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)];
}

function clozePhrase(phrases, startIndex) {
  for (let offset = 0; offset < phrases.length; offset += 1) {
    const phrase = phrases[(startIndex + offset) % phrases.length];
    if (phraseTokens(phrase.lt).length > 1) return phrase;
  }
  return phrases[startIndex];
}

function makeCloze(phrase) {
  const tokens = phraseTokens(phrase.lt);
  const token = tokens[Math.min(1, tokens.length - 1)];
  if (!token) return { answer: '', prompt: phrase.lt };
  return {
    answer: token[0],
    prompt: `${phrase.lt.slice(0, token.index)}_____${phrase.lt.slice(token.index + token[0].length)}`
  };
}

function makeExercises(unit, sessionIndex) {
  const taughtPhrases = sessionIndex < 2 ? unit.phrases.slice(sessionIndex * 4, sessionIndex * 4 + 4) : unit.phrases;
  const currentPhrases = taughtPhrases.length ? taughtPhrases : unit.phrases;
  const isCumulative = sessionIndex === 5 || /checkpoint/i.test(unit.title);
  const practicePhrases = isCumulative && unit.reviewPhrases.length ? [...currentPhrases.slice(0, 2), ...unit.reviewPhrases.filter((_, i) => i % 4 === 0)] : currentPhrases;
  const types = sessionIndex === 0
    ? ['pattern', 'meaning-choice', 'matching', 'cloze', 'listening-choice', 'read-repeat']
    : sessionIndex === 1
      ? ['pattern', 'typed-recall', 'dictation', 'cloze', 'word-order', 'listening-choice']
      : sessionIndex === 2
        ? ['pattern', 'ai-listening', 'meaning-choice', 'read-repeat', 'matching', 'typed-recall']
        : sessionIndex === 3
          ? ['pattern', 'ai-dialogue', 'listening-choice', 'matching', 'word-order', 'typed-recall', 'read-repeat']
          : sessionIndex === 4
            ? ['pattern', 'matching', 'cloze', 'word-order', 'dictation', 'adaptive-translation', 'role-play']
            : ['pattern', 'typed-recall', 'word-order', 'cloze', 'meaning-choice', 'matching', 'typed-recall'];
  const lessonFocus = [
    'Learn the rule and notice it in a complete sentence.',
    'Review the forms before retrieving them from memory.',
    'Connect familiar written phrases with the sounds you hear.',
    'Use the phrases and patterns in a short conversation.',
    'Retrieve familiar phrases and check their spelling and meaning.',
    'Show what you remember from this module and earlier learning.'
  ][sessionIndex];
  const exercises = types.map((type, exerciseIndex) => {
    if (type === 'cloze' && !practicePhrases.some(phrase => phraseTokens(phrase.lt).length > 1)) type = 'meaning-choice';
    const focusIndex = exerciseIndex % practicePhrases.length;
    const focus = type === 'cloze' ? clozePhrase(practicePhrases, focusIndex) : practicePhrases[focusIndex];
    const second = practicePhrases[(focusIndex + 1) % practicePhrases.length];
    const words = phraseTokens(focus.lt).map(token => token[0]);
    const cloze = makeCloze(focus);
    const clozeAnswer = cloze.answer;
    const clozePrompt = cloze.prompt;
    const distractors = practicePhrases.filter(item => item.lt !== focus.lt).map(item => item.en);
    return {
      id: `${unit.id}-s${sessionIndex + 1}-e${exerciseIndex + 1}`,
      type,
      prompt: type === 'pattern' ? unit.title
        : type === 'meaning-choice' ? `What does “${focus.lt}” mean?`
          : type === 'word-order' ? `Build: ${focus.en}`
            : type === 'cloze' ? 'Complete the Lithuanian phrase.'
              : type === 'ai-listening' ? 'Listen for the main idea.'
                : type === 'ai-dialogue' ? 'Complete the goal with your AI partner.'
                  : type === 'adaptive-translation' ? 'Translate the adaptive sentence into Lithuanian.'
              : type === 'listening-choice' ? 'Listen and choose the meaning.'
                : type === 'dictation' ? 'Listen and type what you hear.'
                  : type === 'matching' ? 'Match each phrase with its meaning.'
                    : type === 'dialogue' ? `Write this reply in Lithuanian: ${focus.en}`
                      : type === 'mission' ? `Complete this mission step: ${focus.en}`
                        : type === 'role-play' ? `Say this naturally: ${focus.en}`
                          : type === 'read-repeat' ? 'Listen, then say the phrase aloud.'
                            : `Translate into Lithuanian: ${focus.en}`,
      instruction: type === 'pattern' ? lessonFocus
        : type === 'ai-listening' ? 'The dialogue or passage adapts to your completed lessons and Lithuanian Library.'
          : type === 'ai-dialogue' ? 'Reply naturally in Lithuanian. Your partner checks the meaning, responds, and keeps the role-play moving.'
            : type === 'adaptive-translation' ? 'The sentence length and vocabulary load grow with your course progress.'
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
      rescue: focus.en,
      guide: type === 'pattern' ? unit.guide : null,
      teachingPhrases: type === 'pattern' ? currentPhrases : []
    };
  });
  const forms = buildFormExercise(unit, sessionIndex, COURSE_ORDER.map(index => UNIT_BLUEPRINTS[index][0]));
  if (!forms) return exercises;
  if (sessionIndex === 1 && FORM_TOPICS.some(topic => topic.unitId === unit.id)) {
    const extra = buildFormExercise(unit, sessionIndex, COURSE_ORDER.map(index => UNIT_BLUEPRINTS[index][0]), 5);
    return [...exercises, forms, { ...extra, id: `${extra.id}-extra` }];
  }
  return [...exercises, forms];
}

export const LITHUANIAN_UNITS = Object.freeze(COURSE_ORDER.map((sourceIndex, unitIndex) => {
  const [id, , cefr, title, outcome, grammar, originalPhrases] = UNIT_BLUEPRINTS[sourceIndex];
  const phrases = FOUNDATION_PHRASES[id] || originalPhrases;
  const guide = GRAMMAR_GUIDES[sourceIndex];
  const previousSources = COURSE_ORDER.slice(Math.max(0, unitIndex - 3), unitIndex);
  const reviewPhrases = previousSources.flatMap(index => FOUNDATION_PHRASES[UNIT_BLUEPRINTS[index][0]] || UNIT_BLUEPRINTS[index][6]);
  const unit = { id, unitNumber: unitIndex + 1, sectionNumber: Math.floor(unitIndex / 4) + 1, cefr, title, outcome, grammar, phrases, guide, reviewPhrases, prerequisiteUnitId: unitIndex ? UNIT_BLUEPRINTS[COURSE_ORDER[unitIndex - 1]][0] : null };
  return Object.freeze({
    ...unit,
    sessions: Object.freeze(SESSION_KINDS.map((kind, sessionIndex) => Object.freeze({
      id: `${id}-s${sessionIndex + 1}`,
      unitId: id,
      unitNumber: unitIndex + 1,
      sessionNumber: sessionIndex + 1,
      kind,
      icon: SESSION_ICONS[sessionIndex],
      title: sessionIndex === 0 ? `Learn: ${title}`
        : sessionIndex === 1 ? 'Forms in context'
          : sessionIndex === 2 ? 'Listen & understand'
            : sessionIndex === 3 ? 'Use it in conversation'
              : sessionIndex === 4 ? 'Review & retrieve'
                : 'Can-do checkpoint',
      isCheckpoint: sessionIndex === 5,
      vocabulary: sessionIndex < 2 ? phrases.slice(sessionIndex * 4, sessionIndex * 4 + 4) : [],
      exerciseRevision: unitIndex >= 2 ? 3 : 2,
      durationMinutes: (sessionIndex >= 3 ? 9 : 7) + (unitIndex >= 2 ? 2 : 0),
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
    if (!unit.guide?.summary || !unit.guide?.rule || unit.guide?.forms?.length < 3 || !unit.guide?.tip) errors.push(`${unit.id} needs a complete grammar guide.`);
    if (unit.sessions.length !== 6) errors.push(`${unit.id} must contain six lessons.`);
    for (const session of unit.sessions) {
      if (ids.has(session.id)) errors.push(`Duplicate session ID: ${session.id}`);
      ids.add(session.id);
      if (session.exercises.length < 5 || session.exercises.length > 8) errors.push(`${session.id} must contain 5–8 exercises.`);
      if (session.exercises[0]?.type !== 'pattern' || !session.exercises[0]?.guide) errors.push(`${session.id} must begin with authored teaching.`);
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
