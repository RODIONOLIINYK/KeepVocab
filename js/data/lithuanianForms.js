// Authored beginner drills. References and scope: docs/lithuanian-curriculum.md.
// These are word-specific forms, not a rule engine for arbitrary Lithuanian nouns.
const drill = (base, target, context, meaning, grammaticalCase, number, gender, explanation) => ({
  base, target, context, meaning, grammaticalCase, number, gender, explanation
});
const d = drill;
export const FORM_TOPICS = [
  { unitId: 'sep-03', title: 'Gender and number', drills: [
    d('naujas', 'nauja', 'Tai yra _____ knyga.', 'This is a new book.', 'nominative', 'singular', 'feminine', 'Knyga is feminine: naujas changes to nauja.'),
    d('naujas', 'naujas', 'Tai yra _____ stalas.', 'This is a new table.', 'nominative', 'singular', 'masculine', 'Stalas is masculine: use naujas.'),
    d('naujas', 'nauji', 'Čia yra _____ stalai.', 'Here are new tables.', 'nominative', 'plural', 'masculine', 'Stalai is masculine plural: the adjective is nauji, not naujas.'),
    d('naujas', 'naujos', 'Čia yra _____ knygos.', 'Here are new books.', 'nominative', 'plural', 'feminine', 'Knygos is feminine plural: use naujos.'),
    d('senas', 'sena', 'Tai yra _____ pilis.', 'This is an old castle.', 'nominative', 'singular', 'feminine', 'Pilis is feminine even though it ends in -is. Use sena.'),
    d('jaunas', 'jaunas', 'Mano brolis yra _____.', 'My brother is young.', 'nominative', 'singular', 'masculine', 'Brolis is masculine. The ending -is alone cannot tell you every noun’s gender.')
  ] },
  { unitId: 'dec-13', title: 'Genitive: whose? and of what?', drills: [
    d('brolis', 'brolio', 'Čia yra _____ knyga.', 'Here is the brother’s book.', 'genitive', 'singular', 'masculine', 'The owner takes genitive: brolis → brolio.'),
    d('sesuo', 'sesers', 'Čia yra _____ knyga.', 'Here is the sister’s book.', 'genitive', 'singular', 'feminine', 'Sesuo has a changing stem. Learn sesuo → sesers as a pair.'),
    d('studentas', 'studentų', 'Čia yra _____ knygos.', 'Here are the male students’ books.', 'genitive', 'plural', 'masculine', 'More than one owner: studentai → studentų.'),
    d('studentė', 'studenčių', 'Čia yra _____ knygos.', 'Here are the female students’ books.', 'genitive', 'plural', 'feminine', 'Studentė → studenčių: t changes to č before -ių.'),
    d('moteris', 'moters', 'Čia yra _____ knyga.', 'Here is the woman’s book.', 'genitive', 'singular', 'feminine', 'Moteris is feminine and has the genitive moters. Learn this common exception.'),
    d('knyga', 'knygos', 'Tai yra _____ viršelis.', 'This is the book’s cover.', 'genitive', 'singular', 'feminine', 'One book as possessor: knyga → knygos. Knygos can also be nominative plural; the sentence tells you its role.')
  ] },
  { unitId: 'oct-06', title: 'Accusative objects and genitive after negation', drills: [
    d('knyga', 'knygą', 'Skaitau _____.', 'I am reading a book.', 'accusative', 'singular', 'feminine', 'The direct object of skaitau is accusative: knyga → knygą.'),
    d('stalas', 'stalą', 'Matau _____.', 'I see a table.', 'accusative', 'singular', 'masculine', 'Stalas → stalą for one direct object.'),
    d('knyga', 'knygas', 'Skaitau _____.', 'I am reading books.', 'accusative', 'plural', 'feminine', 'Several books as objects: knygos → knygas.'),
    d('stalas', 'stalus', 'Matau _____.', 'I see tables.', 'accusative', 'plural', 'masculine', 'Several tables as objects: stalai → stalus.'),
    d('knyga', 'knygos', 'Neskaitau _____.', 'I am not reading the book.', 'genitive', 'singular', 'feminine', 'Negating this transitive verb changes the object: skaitau knygą → neskaitau knygos.'),
    d('stalas', 'stalų', 'Nematau _____.', 'I do not see the tables.', 'genitive', 'plural', 'masculine', 'Negation changes the plural object from stalus to stalų.')
  ] },
  { unitId: 'oct-07', title: 'Adjective and noun agreement', drills: [
    d('naujas stalas', 'naują stalą', 'Perku _____.', 'I am buying a new table.', 'accusative', 'singular', 'masculine', 'Change both words to accusative singular: naują stalą.'),
    d('nauja knyga', 'naują knygą', 'Perku _____.', 'I am buying a new book.', 'accusative', 'singular', 'feminine', 'Both feminine words take -ą here: naują knygą.'),
    d('naujas stalas', 'naujus stalus', 'Perku _____.', 'I am buying new tables.', 'accusative', 'plural', 'masculine', 'Masculine plural objects: nauji stalai → naujus stalus.'),
    d('nauja knyga', 'naujas knygas', 'Perku _____.', 'I am buying new books.', 'accusative', 'plural', 'feminine', 'Feminine plural objects: naujos knygos → naujas knygas.'),
    d('naujas stalas', 'naujo stalo', 'Ieškau _____.', 'I am looking for a new table.', 'genitive', 'singular', 'masculine', 'Ieškoti takes genitive: naujo stalo.'),
    d('nauja knyga', 'naujų knygų', 'Ieškau _____.', 'I am looking for new books.', 'genitive', 'plural', 'feminine', 'The adjective and noun both take genitive plural: naujų knygų.')
  ] },
  { unitId: 'dec-15', title: 'Singular to plural noun patterns', drills: [
    d('stalas', 'stalai', 'Čia yra _____.', 'Here are tables.', 'nominative', 'plural', 'masculine', 'The common -as pattern has nominative plural -ai.'),
    d('brolis', 'broliai', 'Čia yra mano _____.', 'Here are my brothers.', 'nominative', 'plural', 'masculine', 'Brolis → broliai. This masculine -is pattern differs from feminine pilis → pilys.'),
    d('kambarys', 'kambariai', 'Čia yra _____.', 'Here are rooms.', 'nominative', 'plural', 'masculine', 'Kambarys → kambariai: -ys changes to -iai.'),
    d('sūnus', 'sūnūs', 'Čia yra mano _____.', 'Here are my sons.', 'nominative', 'plural', 'masculine', 'Sūnus → sūnūs. Keep the long ū in the plural ending.'),
    d('knyga', 'knygos', 'Čia yra _____.', 'Here are books.', 'nominative', 'plural', 'feminine', 'The -a pattern has nominative plural -os.'),
    d('gatvė', 'gatvės', 'Čia yra _____.', 'Here are streets.', 'nominative', 'plural', 'feminine', 'The -ė pattern has nominative plural -ės.')
  ] },
  { unitId: 'nov-09', title: 'Location versus destination', drills: [
    d('miestas', 'mieste', 'Gyvenu _____.', 'I live in a city.', 'locative', 'singular', 'masculine', 'A location takes locative: miestas → mieste, without į.'),
    d('biblioteka', 'bibliotekoje', 'Esu _____.', 'I am in the library.', 'locative', 'singular', 'feminine', 'A feminine -a noun has singular locative -oje.'),
    d('miestas', 'miestuose', 'Jie gyvena _____.', 'They live in cities.', 'locative', 'plural', 'masculine', 'More than one city: miestai → miestuose.'),
    d('biblioteka', 'bibliotekose', 'Dirbame _____.', 'We work in libraries.', 'locative', 'plural', 'feminine', 'More than one library: bibliotekos → bibliotekose.'),
    d('biblioteka', 'biblioteką', 'Einu į _____.', 'I am going to the library.', 'accusative', 'singular', 'feminine', 'A destination uses į + accusative: į biblioteką. Being there uses bibliotekoje.'),
    d('gatvė', 'gatvėje', 'Esu _____.', 'I am in the street.', 'locative', 'singular', 'feminine', 'Gatvė → gatvėje; the -ė class uses -ėje, not -oje.')
  ] },
  { unitId: 'nov-10', title: 'Instrumental: with whom? by what?', drills: [
    d('draugas', 'draugu', 'Kalbu su _____.', 'I am talking with a male friend.', 'instrumental', 'singular', 'masculine', 'Su takes instrumental: draugas → draugu.'),
    d('draugė', 'drauge', 'Kalbu su _____.', 'I am talking with a female friend.', 'instrumental', 'singular', 'feminine', 'Draugė → drauge. Instrumental ends in -e, not -ė.'),
    d('draugas', 'draugais', 'Kalbu su _____.', 'I am talking with male friends.', 'instrumental', 'plural', 'masculine', 'Several companions: su draugais.'),
    d('draugė', 'draugėmis', 'Kalbu su _____.', 'I am talking with female friends.', 'instrumental', 'plural', 'feminine', 'Feminine -ė nouns have instrumental plural -ėmis.'),
    d('autobusas', 'autobusu', 'Važiuoju _____.', 'I am travelling by bus.', 'instrumental', 'singular', 'masculine', 'Means of transport uses instrumental: autobusu.'),
    d('mašina', 'mašinomis', 'Važiuojame _____.', 'We are travelling in cars.', 'instrumental', 'plural', 'feminine', 'Mašina → mašinomis for several cars as means of transport.')
  ] },
  { unitId: 'nov-11', title: 'Vocative: addressing someone', drills: [
    d('brolis', 'broli', '_____, ateik čia!', 'Brother, come here!', 'vocative', 'singular', 'masculine', 'Direct address uses vocative: brolis → broli.'),
    d('draugė', 'drauge', '_____, ateik čia!', 'Female friend, come here!', 'vocative', 'singular', 'feminine', 'Draugė → drauge when speaking directly to her.'),
    d('draugas', 'draugai', '_____, ateikite čia!', 'Male friends, come here!', 'vocative', 'plural', 'masculine', 'Vocative plural matches nominative plural here: draugai.'),
    d('draugė', 'draugės', '_____, ateikite čia!', 'Female friends, come here!', 'vocative', 'plural', 'feminine', 'Vocative plural matches nominative plural here: draugės.'),
    d('Jonas', 'Jonai', '_____, eik tiesiai!', 'Jonas, go straight!', 'vocative', 'singular', 'masculine', 'Names in -as commonly take -ai in direct address: Jonas → Jonai.'),
    d('mama', 'mama', '_____, ateik čia!', 'Mum, come here!', 'vocative', 'singular', 'feminine', 'Mama keeps the same written form in vocative singular.')
  ] },
  { unitId: 'nov-12', title: 'Dative: giving to someone', drills: [
    d('studentas', 'studentui', 'Duodu knygą _____.', 'I am giving a book to a male student.', 'dative', 'singular', 'masculine', 'The recipient takes dative: studentui. The book is still accusative knygą.'),
    d('studentė', 'studentei', 'Duodu knygą _____.', 'I am giving a book to a female student.', 'dative', 'singular', 'feminine', 'Studentė → studentei for one recipient.'),
    d('studentas', 'studentams', 'Duodu knygas _____.', 'I am giving books to male students.', 'dative', 'plural', 'masculine', 'Plural recipients: studentams, with -ams.'),
    d('studentė', 'studentėms', 'Duodu knygas _____.', 'I am giving books to female students.', 'dative', 'plural', 'feminine', 'Plural feminine recipients: studentėms, with -ėms.'),
    d('brolis', 'broliui', 'Duodu knygą _____.', 'I am giving a book to my brother.', 'dative', 'singular', 'masculine', 'Brolis → broliui: the -is class uses -iui.'),
    d('mama', 'mamai', 'Duodu knygą _____.', 'I am giving a book to Mum.', 'dative', 'singular', 'feminine', 'Mama → mamai: the -a class uses -ai.')
  ] }
];

export const NOUN_FORM_TABLES = [
  { word: 'stalas', gender: 'masculine', singular: ['stalas','stalo','stalui','stalą','stalu','stale','stale'], plural: ['stalai','stalų','stalams','stalus','stalais','staluose','stalai'] },
  { word: 'knyga', gender: 'feminine', singular: ['knyga','knygos','knygai','knygą','knyga','knygoje','knyga'], plural: ['knygos','knygų','knygoms','knygas','knygomis','knygose','knygos'] },
  { word: 'brolis', gender: 'masculine', singular: ['brolis','brolio','broliui','brolį','broliu','brolyje','broli'], plural: ['broliai','brolių','broliams','brolius','broliais','broliuose','broliai'] },
  { word: 'gatvė', gender: 'feminine', singular: ['gatvė','gatvės','gatvei','gatvę','gatve','gatvėje','gatve'], plural: ['gatvės','gatvių','gatvėms','gatves','gatvėmis','gatvėse','gatvės'] }
];
export const CASE_LABELS = ['Nominative · vardininkas', 'Genitive · kilmininkas', 'Dative · naudininkas', 'Accusative · galininkas', 'Instrumental · įnagininkas', 'Locative · vietininkas', 'Vocative · šauksmininkas'];

export function buildFormExercise(unit, sessionIndex, orderedUnitIds, drillIndex = sessionIndex) {
  const available = FORM_TOPICS.filter(topic => orderedUnitIds.indexOf(topic.unitId) <= orderedUnitIds.indexOf(unit.id));
  if (!available.length) return null;
  const current = available.find(topic => topic.unitId === unit.id);
  // Each introduction teaches six contrasts; subsequent modules rotate earlier topics.
  const topic = current || available[(unit.unitNumber + sessionIndex) % available.length];
  const item = topic.drills[current ? drillIndex : (unit.unitNumber * 5 + sessionIndex) % topic.drills.length];
  const phrase = item.context.replace('_____', item.target);
  return {
    id: `${unit.id}-s${sessionIndex + 1}-forms`, type: 'form-recall',
    prompt: `Practise endings: ${topic.title}`, instruction: 'Change the base form to fit the sentence. Type the missing word or word pair.',
    phrase: { lt: phrase, en: item.meaning, acceptedForms: [phrase] },
    answer: item.target, acceptedAnswers: [item.target, phrase],
    clozePrompt: item.context, clozeAnswer: item.target, rescue: item.meaning,
    outcomeTag: topic.title, formFocus: { ...item, topicId: topic.unitId },
    audioText: '', matchPairs: [], choices: [], tokens: []
  };
}
