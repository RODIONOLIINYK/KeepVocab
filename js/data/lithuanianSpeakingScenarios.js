const phrase = (lt, en, acceptedForms = []) => ({
  lt,
  en,
  acceptedForms: [...new Set([lt, ...acceptedForms])]
});

const scenarios = [
  ['neighbours-quiet-hours', 'Neighbours & quiet hours', 'Ask a neighbour to reduce the noise and agree on quiet hours.', 'Polite requests and compromise', [
    phrase('Atsiprašau, ar galėtumėte kalbėti šiek tiek tyliau?', 'Excuse me, could you speak a little more quietly?'),
    phrase('Rytoj turiu anksti keltis.', 'I have to get up early tomorrow.'),
    phrase('Suprantu, pasistengsime netriukšmauti.', 'I understand; we will try not to make noise.'),
    phrase('Iki kelintos valandos galima klausytis muzikos?', 'Until what time is it okay to listen to music?')
  ]],
  ['apartment-viewing', 'Apartment viewing', 'Ask practical questions while viewing a flat and decide what to clarify next.', 'Housing costs and conditions', [
    phrase('Norėčiau apžiūrėti šį butą.', 'I would like to view this apartment.'),
    phrase('Ar į kainą įskaičiuoti komunaliniai mokesčiai?', 'Are utility costs included in the price?'),
    phrase('Kiek reikia mokėti užstatą?', 'How much deposit do I need to pay?'),
    phrase('Kada galėčiau įsikelti?', 'When could I move in?')
  ]],
  ['return-damaged-item', 'Return a damaged purchase', 'Explain what went wrong and negotiate a replacement or refund.', 'Past events and preferred solutions', [
    phrase('Norėčiau grąžinti šią prekę.', 'I would like to return this item.'),
    phrase('Ji sugedo po dviejų dienų.', 'It broke after two days.'),
    phrase('Ar turite pirkimo kvitą?', 'Do you have the receipt?'),
    phrase('Norėčiau pakeisti prekę arba atgauti pinigus.', 'I would like to exchange the item or get my money back.')
  ]],
  ['post-office-parcel', 'Collect and send a parcel', 'Collect one parcel and ask how to send another one abroad.', 'Documents, delivery and expected time', [
    phrase('Atėjau atsiimti siuntos.', 'I came to collect a parcel.'),
    phrase('Štai mano asmens dokumentas.', 'Here is my identity document.'),
    phrase('Ar galiu siuntą išsiųsti į užsienį?', 'Can I send the parcel abroad?'),
    phrase('Kada ji turėtų pasiekti gavėją?', 'When should it reach the recipient?')
  ]],
  ['bank-card-problem', 'Solve a bank-card problem', 'Describe a blocked card or unfamiliar payment and ask what happens next.', 'Account problems and formal questions', [
    phrase('Mano kortelė buvo užblokuota.', 'My card was blocked.'),
    phrase('Negaliu prisijungti prie interneto banko.', 'I cannot log in to online banking.'),
    phrase('Ar galite patikrinti šį mokėjimą?', 'Can you check this payment?'),
    phrase('Kada problema bus išspręsta?', 'When will the problem be resolved?')
  ]],
  ['weather-plan-change', 'Change plans because of weather', 'React to bad weather and agree on a realistic alternative plan.', 'Conditional plans and suggestions', [
    phrase('Dėl lietaus turėsime pakeisti planus.', 'Because of the rain, we will have to change our plans.'),
    phrase('Gal vietoj parko eikime į muziejų?', 'Maybe we could go to a museum instead of the park?'),
    phrase('Pažiūrėkime, koks bus oras vakare.', 'Let’s see what the weather will be like this evening.'),
    phrase('Jei nustos lyti, galėsime pasivaikščioti.', 'If it stops raining, we will be able to go for a walk.')
  ]],
  ['internship-first-day', 'First day at an internship', 'Ask for instructions, identify the right colleague and confirm your tasks.', 'Workplace requests and responsibilities', [
    phrase('Šiandien mano pirma praktikos diena.', 'Today is my first day at the internship.'),
    phrase('Gal galite parodyti, nuo ko pradėti?', 'Could you show me where to start?'),
    phrase('Kam turėčiau siųsti šią ataskaitą?', 'Who should I send this report to?'),
    phrase('Ar galime trumpai aptarti mano užduotis?', 'Can we briefly discuss my tasks?')
  ]],
  ['phone-appointment', 'Arrange an appointment by phone', 'Find a suitable appointment time and move it when the first option fails.', 'Telephone register and rescheduling', [
    phrase('Laba diena, norėčiau užsiregistruoti vizitui.', 'Good afternoon, I would like to make an appointment.'),
    phrase('Ar turite laisvą laiką ketvirtadienį?', 'Do you have an available time on Thursday?'),
    phrase('Deja, tuo metu negaliu.', 'Unfortunately, I cannot make that time.'),
    phrase('Gal galėtume perkelti vizitą į penktadienį?', 'Could we move the appointment to Friday?')
  ]],
  ['host-guests', 'Welcome guests at home', 'Welcome visitors, offer refreshments and handle a small awkward moment.', 'Offers, hospitality and reassurance', [
    phrase('Smagu, kad atvykote.', 'It is lovely that you came.'),
    phrase('Ar norėtumėte ko nors atsigerti?', 'Would you like something to drink?'),
    phrase('Jauskitės kaip namie.', 'Make yourselves at home.'),
    phrase('Atsiprašau, kad kambarys toks mažas.', 'I am sorry that the room is so small.')
  ]],
  ['join-hobby-club', 'Join a hobby club', 'Ask about a club, equipment and experience before joining.', 'Frequency, requirements and experience', [
    phrase('Norėčiau prisijungti prie jūsų klubo.', 'I would like to join your club.'),
    phrase('Kaip dažnai vyksta užsiėmimai?', 'How often do the sessions take place?'),
    phrase('Ar reikia turėti savo įrangą?', 'Do I need to have my own equipment?'),
    phrase('Dar neturiu daug patirties, bet noriu išmokti.', 'I do not have much experience yet, but I want to learn.')
  ]],
  ['lost-property', 'Report lost property', 'Describe a missing bag and ask where recovered items are kept.', 'Past location and object description', [
    phrase('Manau, kad autobuse palikau kuprinę.', 'I think I left my backpack on the bus.'),
    phrase('Kada ją paskutinį kartą matėte?', 'When did you last see it?'),
    phrase('Ji mėlyna, su juodu užtrauktuku.', 'It is blue, with a black zipper.'),
    phrase('Kur galėčiau patikrinti rastus daiktus?', 'Where could I check the lost-and-found items?')
  ]],
  ['cancelled-train', 'Handle a cancelled train', 'Find another route while protecting a same-day hotel reservation.', 'Travel disruption and alternatives', [
    phrase('Mūsų traukinys buvo atšauktas.', 'Our train was cancelled.'),
    phrase('Ar galime važiuoti kitu maršrutu?', 'Can we travel by another route?'),
    phrase('Turime viešbučio rezervaciją šiam vakarui.', 'We have a hotel reservation for this evening.'),
    phrase('Koks greičiausias būdas ten nuvykti?', 'What is the fastest way to get there?')
  ]]
];

export const LITHUANIAN_A2_SPEAKING_SCENARIOS = Object.freeze(scenarios.map((scenario, index) => {
  const [slug, title, outcome, grammar, phrases] = scenario;
  return Object.freeze({
    id: `a2-lab-${slug}`,
    unitNumber: 37 + index,
    sectionNumber: 10,
    speakingStageId: 'a2-lab',
    speakingStageTitle: 'A2 conversation lab',
    cefr: 'A2',
    title,
    outcome,
    grammar,
    phrases: Object.freeze(phrases.map(item => Object.freeze(item)))
  });
}));
