// Localized SMS bodies for the message_templates table (PK: key, locale, channel).
// Locales mirror src/i18n/locales: en, ha (Hausa), yo (Yoruba), ig (Igbo),
// pcm (Nigerian Pidgin). Bodies are written in ASCII-safe orthography (no
// diacritics) so they stay in GSM-7 encoding and fit one 160-char segment.

export interface MessageTemplateRow {
  key: string;
  locale: string;
  channel: "sms" | "whatsapp";
  subject: string | null;
  body: string;
  max_length: number;
}

export const MESSAGE_TEMPLATES: MessageTemplateRow[] = [
  // medication_reminder — vars: {{patient_name}}, {{medication}}, {{dosage}}
  {
    key: "medication_reminder",
    locale: "en",
    channel: "sms",
    subject: null,
    body: "mBHR: Hello {{patient_name}}, please remember to take your {{medication}} ({{dosage}}) as prescribed. Stay well.",
    max_length: 160,
  },
  {
    key: "medication_reminder",
    locale: "ha",
    channel: "sms",
    subject: null,
    body: "mBHR: Sannu {{patient_name}}, don Allah ku tuna shan maganinku {{medication}} ({{dosage}}) kamar yadda likita ya ce.",
    max_length: 160,
  },
  {
    key: "medication_reminder",
    locale: "yo",
    channel: "sms",
    subject: null,
    body: "mBHR: {{patient_name}}, e ma gbagbe lati mu oogun yin {{medication}} ({{dosage}}) gege bi dokita se so. E se.",
    max_length: 160,
  },
  {
    key: "medication_reminder",
    locale: "ig",
    channel: "sms",
    subject: null,
    body: "mBHR: Ndewo {{patient_name}}, biko cheta inu ogwu gi {{medication}} ({{dosage}}) otu dokita si gwa gi.",
    max_length: 160,
  },
  {
    key: "medication_reminder",
    locale: "pcm",
    channel: "sms",
    subject: null,
    body: "mBHR: {{patient_name}}, abeg no forget to take your medicine {{medication}} ({{dosage}}) as doctor talk am.",
    max_length: 160,
  },

  // follow_up_reminder — vars: {{patient_name}}, {{date}}, {{site_name}}
  {
    key: "follow_up_reminder",
    locale: "en",
    channel: "sms",
    subject: null,
    body: "mBHR: Hello {{patient_name}}, your follow-up visit is on {{date}} at {{site_name}}. Please come with your card.",
    max_length: 160,
  },
  {
    key: "follow_up_reminder",
    locale: "ha",
    channel: "sms",
    subject: null,
    body: "mBHR: Sannu {{patient_name}}, kuna da alkawarin ganin likita ranar {{date}} a {{site_name}}. Don Allah ku zo da katinku.",
    max_length: 160,
  },
  {
    key: "follow_up_reminder",
    locale: "yo",
    channel: "sms",
    subject: null,
    body: "mBHR: {{patient_name}}, e ranti lati pada wa fun itoju ni ojo {{date}} ni {{site_name}}. E wa pelu kaadi yin. E se.",
    max_length: 160,
  },
  {
    key: "follow_up_reminder",
    locale: "ig",
    channel: "sms",
    subject: null,
    body: "mBHR: Ndewo {{patient_name}}, ubochi nleta ozo gi bu {{date}} na {{site_name}}. Biko jiri kaadi gi bia.",
    max_length: 160,
  },
  {
    key: "follow_up_reminder",
    locale: "pcm",
    channel: "sms",
    subject: null,
    body: "mBHR: {{patient_name}}, no forget say you get follow-up visit for {{date}} for {{site_name}}. Abeg come with your card.",
    max_length: 160,
  },

  // outreach_announcement — vars: {{date}}, {{site_name}}
  {
    key: "outreach_announcement",
    locale: "en",
    channel: "sms",
    subject: null,
    body: "mBHR: Free medical outreach on {{date}} at {{site_name}}. Free checks and medicines. Everyone is welcome. Please bring your card.",
    max_length: 160,
  },
  {
    key: "outreach_announcement",
    locale: "ha",
    channel: "sms",
    subject: null,
    body: "mBHR: Za a yi gangamin kiwon lafiya kyauta ranar {{date}} a {{site_name}}. Kowa na iya zuwa. Ku zo da katinku idan kuna da shi.",
    max_length: 160,
  },
  {
    key: "outreach_announcement",
    locale: "yo",
    channel: "sms",
    subject: null,
    body: "mBHR: Itoju ilera ofe yoo waye ni ojo {{date}} ni {{site_name}}. Ayewo ati oogun ofe. Gbogbo eniyan ni a pe. E wa pelu kaadi yin.",
    max_length: 160,
  },
  {
    key: "outreach_announcement",
    locale: "ig",
    channel: "sms",
    subject: null,
    body: "mBHR: Ogwugwo na nyocha ahuike n'efu ga-adi na {{date}} na {{site_name}}. A na-akpo onye obula. Biko jiri kaadi gi bia.",
    max_length: 160,
  },
  {
    key: "outreach_announcement",
    locale: "pcm",
    channel: "sms",
    subject: null,
    body: "mBHR: Free medical outreach go hold for {{date}} for {{site_name}}. Check-up and medicine na free. Make una come o. No forget your card.",
    max_length: 160,
  },

  // visit_thank_you — vars: {{patient_name}}
  {
    key: "visit_thank_you",
    locale: "en",
    channel: "sms",
    subject: null,
    body: "mBHR: Thank you for your visit, {{patient_name}}. Take your medicines as instructed. If symptoms get worse, please come back or contact us.",
    max_length: 160,
  },
  {
    key: "visit_thank_you",
    locale: "ha",
    channel: "sms",
    subject: null,
    body: "mBHR: Mun gode da zuwanku, {{patient_name}}. Ku sha magungunanku kamar yadda aka nuna. Idan rashin lafiya ya karu, ku dawo ko ku tuntube mu.",
    max_length: 160,
  },
  {
    key: "visit_thank_you",
    locale: "yo",
    channel: "sms",
    subject: null,
    body: "mBHR: A dupe fun wiwa yin, {{patient_name}}. E lo oogun yin bi a se so fun yin. Ti aisan ba buru si i, e pada wa tabi e pe wa.",
    max_length: 160,
  },
  {
    key: "visit_thank_you",
    locale: "ig",
    channel: "sms",
    subject: null,
    body: "mBHR: Daalu maka obibia gi, {{patient_name}}. Na-anu ogwu gi otu e si gwa gi. O buru na o na-aka njo, biko bia ozo ma o bu kpoo anyi.",
    max_length: 160,
  },
  {
    key: "visit_thank_you",
    locale: "pcm",
    channel: "sms",
    subject: null,
    body: "mBHR: {{patient_name}}, thank you as you come see us. Take your medicine as dem talk am. If your body come worse, abeg come back or call us.",
    max_length: 160,
  },

  // otp — vars: {{otp}} (also inlined in supabase/functions/send-otp-sms)
  {
    key: "otp",
    locale: "en",
    channel: "sms",
    subject: null,
    body: "Your mBHR verification code is {{otp}}. It expires in 10 minutes. Do not share this code with anyone.",
    max_length: 160,
  },
  {
    key: "otp",
    locale: "ha",
    channel: "sms",
    subject: null,
    body: "Lambar tabbatarwa ta mBHR: {{otp}}. Tana karewa cikin minti 10. Kada ku ba kowa wannan lambar.",
    max_length: 160,
  },
  {
    key: "otp",
    locale: "yo",
    channel: "sms",
    subject: null,
    body: "Koodu ijerisi mBHR yin ni {{otp}}. Yoo pari laarin iseju 10. E ma fi han enikeni.",
    max_length: 160,
  },
  {
    key: "otp",
    locale: "ig",
    channel: "sms",
    subject: null,
    body: "Koodu nkwenye mBHR gi bu {{otp}}. O ga-agwu n'ime nkeji 10. Agwala onye obula ya.",
    max_length: 160,
  },
  {
    key: "otp",
    locale: "pcm",
    channel: "sms",
    subject: null,
    body: "Your mBHR code na {{otp}}. E go expire after 10 minutes. Abeg no give anybody this code.",
    max_length: 160,
  },

  // test_message — no vars (used by scripts/send-test-sms.ts)
  {
    key: "test_message",
    locale: "en",
    channel: "sms",
    subject: null,
    body: "mBHR: This is a test message. Your SMS setup is working correctly.",
    max_length: 160,
  },
  {
    key: "test_message",
    locale: "ha",
    channel: "sms",
    subject: null,
    body: "mBHR: Wannan sakon gwaji ne (test). Tsarin SMS na mBHR yana aiki yadda ya kamata.",
    max_length: 160,
  },
  {
    key: "test_message",
    locale: "yo",
    channel: "sms",
    subject: null,
    body: "mBHR: Eyi ni test SMS. Eto ifiranse mBHR n sise daadaa.",
    max_length: 160,
  },
  {
    key: "test_message",
    locale: "ig",
    channel: "sms",
    subject: null,
    body: "mBHR: Nke a bu ozi test. SMS mBHR na-aru oru nke oma.",
    max_length: 160,
  },
  {
    key: "test_message",
    locale: "pcm",
    channel: "sms",
    subject: null,
    body: "mBHR: Na test message be this. The SMS setup dey work well well.",
    max_length: 160,
  },
];
