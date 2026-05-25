/**
 * Universities (KK) seed — idempotent test data loader for Phase 17.
 *
 *   npm run seed:universities-kk
 *   npm run seed:universities-kk -- --dry-run        # parse + log, do not write
 *   npm run seed:universities-kk -- --wipe           # hard-delete existing rows first
 *
 * Populates four tables with realistic Kazakhstani higher-ed test data:
 *   1. specialties              — ~20 bachelor specialty codes (B001..B142)
 *   2. universities             — ~20 universities (KazNU, ENU, NU, KIMEP, ...)
 *   3. university_specialties   — link grid (each uni → a curated subset)
 *   4. admission_stats          — grants_count / threshold / threshold_rural
 *                                 for 2023, 2024, 2025
 *
 * Idempotent: re-running upserts by stable natural keys (`unik`, `code`,
 * `(university_id, specialty_id)`, `(university_specialty_id, year)`), so
 * the seed is safe to run on top of itself.
 */

import { PrismaClient } from '../../generated/prisma';

const prisma = new PrismaClient();

interface UniversityFixture {
    unik: string;
    title_kk: string;
    short_desc_kk: string;
    full_desc_kk: string;
    city_id: number;
    website?: string;
    phone?: string;
    email?: string;
    instagram?: string;
    address?: string;
    has_dormitory: boolean;
    has_military_department: boolean;
}

interface SpecialtyFixture {
    code: string;
    title_kk: string;
}

// City IDs from the regions seed — only "city"-type regions are valid for
// universities.city_id (see UniversitiesMutationsService.assertCityValid).
// For oblast-only entries we use the oblast row (also type='city' in our schema).
const CITY = {
    ASTANA: 2,
    ALMATY: 259,
    SHYMKENT: 767,
    ABAI: 1130,
    AKMOLA: 1542,
    AKTOBE: 2222,
    ALMATY_OBL: 2762,
    ATYRAU: 3346,
    EAST_KZ: 3650,
    ZHAMBYL: 4118,
    ZHETYSU: 4751,
    WEST_KZ: 5157,
    KARAGANDA: 5637,
    KOSTANAY: 6187,
    KYZYLORDA: 6775,
    MANGYSTAU: 7198,
    PAVLODAR: 7472,
    NORTH_KZ: 7952,
    TURKESTAN: 8498,
    ULYTAU: 9725,
};

const SPECIALTIES: SpecialtyFixture[] = [
    { code: 'B001', title_kk: 'Білім берудегі педагогика және психология' },
    { code: 'B002', title_kk: 'Мектепке дейінгі тәрбие және оқыту' },
    { code: 'B005', title_kk: 'Тіл мен әдебиет педагогикасы (қазақ тілі)' },
    { code: 'B006', title_kk: 'Тіл мен әдебиет педагогикасы (орыс тілі)' },
    { code: 'B009', title_kk: 'Математика педагогикасы' },
    { code: 'B010', title_kk: 'Физика педагогикасы' },
    { code: 'B011', title_kk: 'Информатика педагогикасы' },
    { code: 'B012', title_kk: 'Химия педагогикасы' },
    { code: 'B016', title_kk: 'Тарих педагогикасы' },
    { code: 'B041', title_kk: 'Бизнес және басқару' },
    { code: 'B042', title_kk: 'Қаржы, экономика, банк және сақтандыру ісі' },
    { code: 'B044', title_kk: 'Менеджмент және басқару' },
    { code: 'B045', title_kk: 'Аудит және салық салу' },
    { code: 'B046', title_kk: 'Маркетинг және жарнама' },
    { code: 'B047', title_kk: 'Заңтану' },
    { code: 'B048', title_kk: 'Халықаралық қатынастар' },
    { code: 'B057', title_kk: 'Ақпараттық технологиялар' },
    { code: 'B058', title_kk: 'Ақпараттық қауіпсіздік' },
    { code: 'B059', title_kk: 'Шетел филологиясы' },
    { code: 'B062', title_kk: 'Электр техникасы және энергетика' },
    { code: 'B063', title_kk: 'Электр техникасы және автоматтандыру' },
    { code: 'B071', title_kk: 'Тау-кен ісі' },
    { code: 'B072', title_kk: 'Мұнай газ ісі' },
    { code: 'B084', title_kk: 'Жалпы медицина' },
    { code: 'B085', title_kk: 'Стоматология' },
    { code: 'B086', title_kk: 'Фармация' },
    { code: 'B091', title_kk: 'Туризм' },
    { code: 'B094', title_kk: 'Ауыл шаруашылығы' },
    { code: 'B142', title_kk: 'Журналистика және репортерлік іс' },
    { code: 'B148', title_kk: 'Көлік, көлік техникасы және технологиялары' },
];

const UNIVERSITIES: UniversityFixture[] = [
    {
        unik: 'KAZNU',
        title_kk: 'Әл-Фараби атындағы Қазақ ұлттық университеті',
        short_desc_kk: 'Қазақстанның жетекші көп салалы зерттеу университеті.',
        full_desc_kk:
            '1934 жылы құрылған, ел бойынша QS рейтингінде ең жоғары орынды иеленетін фундаменталды және қолданбалы ғылыми зерттеулерге бағдарланған классикалық университет. 15-тен астам факультет, 100-ден астам білім беру бағдарламасы.',
        city_id: CITY.ALMATY,
        website: 'https://www.kaznu.kz',
        phone: '+7 (727) 377-33-30',
        email: 'rector@kaznu.kz',
        instagram: '@kaznu_official',
        address: 'Алматы қ., әл-Фараби даңғ., 71',
        has_dormitory: true,
        has_military_department: true,
    },
    {
        unik: 'ENU',
        title_kk: 'Л.Н. Гумилев атындағы Еуразия ұлттық университеті',
        short_desc_kk: 'Елорданың жетекші классикалық университеті.',
        full_desc_kk:
            '1996 жылы құрылған ұлттық университет. 13 факультет, гуманитарлық, жаратылыстану және техникалық бағыттардағы 90-нан астам бакалавр бағдарламасы. Болашақ стипендиаттарының басым бөлігі осы жерде білім алады.',
        city_id: CITY.ASTANA,
        website: 'https://www.enu.kz',
        phone: '+7 (7172) 70-95-00',
        email: 'info@enu.kz',
        instagram: '@enu_official',
        address: 'Астана қ., Қ. Сәтбаев көш., 2',
        has_dormitory: true,
        has_military_department: true,
    },
    {
        unik: 'NU',
        title_kk: 'Назарбаев Университеті',
        short_desc_kk: 'Ағылшын тілінде оқытатын зерттеу университеті.',
        full_desc_kk:
            '2010 жылы құрылған Қазақстанның алғашқы автономиялық зерттеу университеті. Барлық бағдарламалар ағылшын тілінде, серіктестер: Duke, UCL, Wisconsin-Madison, Pittsburgh, Cambridge.',
        city_id: CITY.ASTANA,
        website: 'https://nu.edu.kz',
        phone: '+7 (7172) 70-66-66',
        email: 'admissions@nu.edu.kz',
        instagram: '@nu_kazakhstan',
        address: 'Астана қ., Қабанбай батыр даңғ., 53',
        has_dormitory: true,
        has_military_department: false,
    },
    {
        unik: 'KAZNTU',
        title_kk: 'Қ.И. Сәтбаев атындағы Қазақ ұлттық техникалық зерттеу университеті',
        short_desc_kk: 'Сәтбаев Университеті — еліміздегі ең көне техникалық ЖОО.',
        full_desc_kk:
            '1934 жылы құрылған. Тау-кен металлургия, мұнай-газ, IT, энергетика бағыттарының кадр шеберханасы. 12 институт, 20 мыңнан астам студент.',
        city_id: CITY.ALMATY,
        website: 'https://satbayev.university',
        phone: '+7 (727) 257-70-67',
        email: 'info@satbayev.university',
        instagram: '@satbayev_university',
        address: 'Алматы қ., Сәтбаев көш., 22',
        has_dormitory: true,
        has_military_department: true,
    },
    {
        unik: 'KIMEP',
        title_kk: 'КИМЭП Университеті',
        short_desc_kk: 'Бизнес және қоғамдық саясат бойынша жетекші жеке университет.',
        full_desc_kk:
            '1992 жылы құрылған, ағылшын тілінде оқытатын американ үлгісіндегі университет. Bang College of Business халықаралық AACSB аккредитациясына ие.',
        city_id: CITY.ALMATY,
        website: 'https://kimep.kz',
        phone: '+7 (727) 270-44-40',
        email: 'admissions@kimep.kz',
        instagram: '@kimep_university',
        address: 'Алматы қ., Әбай даңғ., 4',
        has_dormitory: true,
        has_military_department: false,
    },
    {
        unik: 'KAZNMU',
        title_kk: 'С.Ж. Асфендияров атындағы Қазақ ұлттық медицина университеті',
        short_desc_kk: 'Қазақстандағы ең көне медициналық университет.',
        full_desc_kk:
            '1930 жылы құрылған. Жалпы медицина, стоматология, фармация, қоғамдық денсаулық сақтау бойынша 8 факультет.',
        city_id: CITY.ALMATY,
        website: 'https://kaznmu.kz',
        phone: '+7 (727) 292-78-71',
        email: 'info@kaznmu.kz',
        instagram: '@kaznmu_official',
        address: 'Алматы қ., Төле би көш., 94',
        has_dormitory: true,
        has_military_department: true,
    },
    {
        unik: 'KAZNAU',
        title_kk: 'Қазақ ұлттық аграрлық зерттеу университеті',
        short_desc_kk: 'Аграрлық ғылым мен агробизнес кадрларын дайындайтын жетекші ЖОО.',
        full_desc_kk:
            '1929 жылы құрылған. Агрономия, ветеринария, тамақ өнеркәсібі, су ресурстары, орман шаруашылығы — 12 факультет.',
        city_id: CITY.ALMATY,
        website: 'https://kaznau.kz',
        phone: '+7 (727) 264-37-89',
        email: 'info@kaznau.kz',
        instagram: '@kaznaru_official',
        address: 'Алматы қ., Абай даңғ., 8',
        has_dormitory: true,
        has_military_department: false,
    },
    {
        unik: 'AUES',
        title_kk: 'Ғ. Дәукеев атындағы Алматы энергетика және байланыс университеті',
        short_desc_kk: 'Энергетика және телекоммуникация саласы үшін мамандар дайындайды.',
        full_desc_kk:
            '1975 жылы құрылған. Электр энергетикасы, жылу энергетикасы, IT және байланыс бағыттары бойынша еліміздегі негізгі техникалық ЖОО-ның бірі.',
        city_id: CITY.ALMATY,
        website: 'https://aues.edu.kz',
        phone: '+7 (727) 292-50-58',
        email: 'info@aues.edu.kz',
        instagram: '@aues_official',
        address: 'Алматы қ., Байтұрсынұлы көш., 126/1',
        has_dormitory: true,
        has_military_department: true,
    },
    {
        unik: 'SDU',
        title_kk: 'Сулейман Демирель атындағы университеті',
        short_desc_kk: 'Алматы маңындағы халықаралық университет.',
        full_desc_kk:
            '1996 жылы құрылған, негізінен ағылшын тілінде оқытады. Инженерия, IT, экономика, педагогика бағыттары бойынша Түркия және АҚШ университеттерімен серіктестікте.',
        city_id: CITY.ALMATY_OBL,
        website: 'https://sdu.edu.kz',
        phone: '+7 (727) 307-95-65',
        email: 'admission@sdu.edu.kz',
        instagram: '@sdu_kazakhstan',
        address: 'Қаскелең қ., Абылай хан даңғ., 1/1',
        has_dormitory: true,
        has_military_department: false,
    },
    {
        unik: 'AIU',
        title_kk: 'Алматы Менеджмент Университеті',
        short_desc_kk: 'Орталық Азиядағы алғашқы бизнес-мектеп.',
        full_desc_kk:
            '1988 жылы құрылған AlmaU — Қазақстандағы кәсіпкерлік білім берудің көшбасшысы. Үш AACSB деңгейіндегі аккредитация: бизнес, бухгалтерлік есеп, MBA.',
        city_id: CITY.ALMATY,
        website: 'https://almau.edu.kz',
        phone: '+7 (727) 313-28-70',
        email: 'info@almau.edu.kz',
        instagram: '@almau_university',
        address: 'Алматы қ., Розыбакиев көш., 227',
        has_dormitory: true,
        has_military_department: false,
    },
    {
        unik: 'UIB',
        title_kk: 'Халықаралық бизнес университеті',
        short_desc_kk: 'Бизнес, IT, дизайн бағыттарын біріктірген университет.',
        full_desc_kk:
            '1992 жылы құрылған. Цифрлық экономика мен инновация бағыттарына мамандандырылған. Қос диплом бағдарламалары Ұлыбритания мен Малайзия университеттерімен.',
        city_id: CITY.ALMATY,
        website: 'https://uib.kz',
        phone: '+7 (727) 259-80-33',
        email: 'admission@uib.kz',
        instagram: '@uib_university',
        address: 'Алматы қ., Абай даңғ., 8А',
        has_dormitory: false,
        has_military_department: false,
    },
    {
        unik: 'KARSU',
        title_kk: 'Е.А. Бөкетов атындағы Қарағанды университеті',
        short_desc_kk: 'Орталық Қазақстандағы жетекші классикалық ЖОО.',
        full_desc_kk:
            '1972 жылы құрылған. Жаратылыстану, гуманитарлық, заң, экономика бағыттары бойынша 13 факультет. 15 мыңнан астам студент.',
        city_id: CITY.KARAGANDA,
        website: 'https://buketov.edu.kz',
        phone: '+7 (7212) 77-04-32',
        email: 'office@buketov.edu.kz',
        instagram: '@buketov_university',
        address: 'Қарағанды қ., Университет көш., 28',
        has_dormitory: true,
        has_military_department: true,
    },
    {
        unik: 'ASTU',
        title_kk: 'С. Сейфуллин атындағы Қазақ агротехникалық зерттеу университеті',
        short_desc_kk: 'Елорданың агротехникалық бағыттағы жетекші ЖОО.',
        full_desc_kk:
            '1957 жылы құрылған. Агрономия, ветеринария, көлік, IT, энергетика бағыттары бойынша 8 факультет.',
        city_id: CITY.ASTANA,
        website: 'https://kazatu.edu.kz',
        phone: '+7 (7172) 39-77-21',
        email: 'info@kazatu.kz',
        instagram: '@kazatu_university',
        address: 'Астана қ., Жеңіс даңғ., 62',
        has_dormitory: true,
        has_military_department: true,
    },
    {
        unik: 'SKSU',
        title_kk: 'М. Әуезов атындағы Оңтүстік Қазақстан университеті',
        short_desc_kk: 'Оңтүстік Қазақстанның жетекші зерттеу ЖОО.',
        full_desc_kk:
            '1943 жылы құрылған. Химия-технология, машина жасау, медицина, педагогика, гуманитарлық бағыттар. 25 мыңнан астам студент.',
        city_id: CITY.SHYMKENT,
        website: 'https://ukgu.kz',
        phone: '+7 (7252) 21-01-41',
        email: 'rector@ukgu.kz',
        instagram: '@ukgu_official',
        address: 'Шымкент қ., Тауке хан даңғ., 5',
        has_dormitory: true,
        has_military_department: true,
    },
    {
        unik: 'YasU',
        title_kk: 'Қ.А. Ясауи атындағы Халықаралық қазақ-түрік университеті',
        short_desc_kk: 'Түркі әлемінің ең көне университеттерінің мирасқоры.',
        full_desc_kk:
            '1991 жылы Қазақстан мен Түркия үкіметтерінің бірлескен шартымен құрылған. Гуманитарлық, медицина, инженерия, теология бағыттары.',
        city_id: CITY.TURKESTAN,
        website: 'https://ayu.edu.kz',
        phone: '+7 (72533) 6-36-36',
        email: 'info@ayu.edu.kz',
        instagram: '@yasawi_university',
        address: 'Түркістан қ., Б. Саттарханов даңғ., 29',
        has_dormitory: true,
        has_military_department: false,
    },
    {
        unik: 'EKTU',
        title_kk: 'Д. Серікбаев атындағы Шығыс Қазақстан техникалық университеті',
        short_desc_kk: 'Шығыс Қазақстанның басты техникалық университеті.',
        full_desc_kk:
            '1958 жылы құрылған. Тау-кен, металлургия, машина жасау, IT, энергетика бағыттары. Аймақтың өндірістік кадрларын дайындайтын негізгі орын.',
        city_id: CITY.EAST_KZ,
        website: 'https://ektu.kz',
        phone: '+7 (7232) 54-04-04',
        email: 'rector@ektu.kz',
        instagram: '@ektu_official',
        address: 'Өскемен қ., А.К. Протозанов көш., 69',
        has_dormitory: true,
        has_military_department: true,
    },
    {
        unik: 'PSU',
        title_kk: 'С. Торайғыров атындағы Павлодар педагогикалық университеті',
        short_desc_kk: 'Павлодар облысының классикалық ЖОО.',
        full_desc_kk:
            '1962 жылы құрылған. Педагогика, гуманитарлық, жаратылыстану, экономика бағыттары бойынша 10 факультет.',
        city_id: CITY.PAVLODAR,
        website: 'https://tou.edu.kz',
        phone: '+7 (7182) 67-36-78',
        email: 'info@tou.edu.kz',
        instagram: '@toraighyrov_university',
        address: 'Павлодар қ., Ломов көш., 64',
        has_dormitory: true,
        has_military_department: true,
    },
    {
        unik: 'KSU',
        title_kk: 'Ш. Есенов атындағы Каспий технологиялар және инжиниринг университеті',
        short_desc_kk: 'Каспий маңы мұнай-газ саласының тірегі.',
        full_desc_kk:
            '1976 жылы құрылған. Мұнай-газ ісі, теңіз көлігі, экология бағыттары бойынша мамандарды дайындайтын аймақтық техникалық ЖОО.',
        city_id: CITY.MANGYSTAU,
        website: 'https://yu.edu.kz',
        phone: '+7 (7292) 43-15-15',
        email: 'info@yu.edu.kz',
        instagram: '@yessenov_university',
        address: 'Ақтау қ., 32-микроаудан',
        has_dormitory: true,
        has_military_department: false,
    },
    {
        unik: 'SKU',
        title_kk: 'М. Қозыбаев атындағы Солтүстік Қазақстан университеті',
        short_desc_kk: 'Солтүстік аймақтың жетекші классикалық университеті.',
        full_desc_kk:
            '1937 жылы құрылған. Гуманитарлық, жаратылыстану, аграрлық-техникалық, экономика бағыттары.',
        city_id: CITY.NORTH_KZ,
        website: 'https://nkzu.kz',
        phone: '+7 (7152) 49-15-50',
        email: 'info@nkzu.kz',
        instagram: '@nkzu_official',
        address: 'Петропавл қ., Пушкин көш., 86',
        has_dormitory: true,
        has_military_department: true,
    },
    {
        unik: 'ZKATU',
        title_kk: 'Жәңгір хан атындағы Батыс Қазақстан аграрлық-техникалық университеті',
        short_desc_kk: 'Батыс өңірінің аграрлық-техникалық кадр шеберханасы.',
        full_desc_kk:
            '1963 жылы құрылған. Агрономия, ветеринария, мұнай-газ ісі, инженерия, экономика бағыттары. 8 факультет.',
        city_id: CITY.WEST_KZ,
        website: 'https://wkau.kz',
        phone: '+7 (7112) 50-13-74',
        email: 'info@wkau.kz',
        instagram: '@wkatu_official',
        address: 'Орал қ., Жәңгір хан көш., 51',
        has_dormitory: true,
        has_military_department: true,
    },
];

// Map of UNIK → array of specialty codes the university offers.
// Curated by realistic faculty mix per institution.
const UNIVERSITY_SPECIALTIES: Record<string, string[]> = {
    KAZNU: ['B005', 'B006', 'B009', 'B010', 'B011', 'B016', 'B041', 'B042', 'B047', 'B048', 'B057', 'B058', 'B059', 'B142'],
    ENU: ['B001', 'B005', 'B009', 'B011', 'B016', 'B041', 'B042', 'B047', 'B048', 'B057', 'B059', 'B142'],
    NU: ['B041', 'B042', 'B044', 'B047', 'B048', 'B057', 'B058', 'B059', 'B062', 'B063', 'B084'],
    KAZNTU: ['B057', 'B062', 'B063', 'B071', 'B072', 'B148'],
    KIMEP: ['B041', 'B042', 'B044', 'B045', 'B046', 'B047', 'B048', 'B057'],
    KAZNMU: ['B084', 'B085', 'B086'],
    KAZNAU: ['B086', 'B091', 'B094'],
    AUES: ['B057', 'B058', 'B062', 'B063'],
    SDU: ['B001', 'B005', 'B009', 'B011', 'B041', 'B057', 'B059', 'B063'],
    AIU: ['B041', 'B042', 'B044', 'B045', 'B046', 'B047', 'B091'],
    UIB: ['B041', 'B042', 'B044', 'B045', 'B046', 'B057'],
    KARSU: ['B001', 'B005', 'B009', 'B010', 'B012', 'B016', 'B041', 'B047', 'B057', 'B059', 'B142'],
    ASTU: ['B057', 'B062', 'B086', 'B094', 'B148'],
    SKSU: ['B001', 'B009', 'B010', 'B011', 'B012', 'B041', 'B057', 'B062', 'B063', 'B084', 'B085', 'B148'],
    YasU: ['B001', 'B005', 'B016', 'B047', 'B059', 'B084', 'B142'],
    EKTU: ['B057', 'B062', 'B063', 'B071', 'B148'],
    PSU: ['B001', 'B005', 'B009', 'B011', 'B016', 'B041', 'B057', 'B059'],
    KSU: ['B057', 'B062', 'B072', 'B148'],
    SKU: ['B001', 'B005', 'B009', 'B011', 'B016', 'B041', 'B057', 'B086', 'B094', 'B142'],
    ZKATU: ['B057', 'B072', 'B086', 'B094', 'B148'],
};

// Per-specialty admission-stat profile. Values are picked once per
// (univ, specialty), then mildly perturbed year-over-year (see `jitter`).
// Threshold ceiling = 140 (ЕНТ max). Rural threshold ≈ threshold - 10..20.
interface StatProfile {
    grants_base: number;
    threshold_base: number;
    has_rural_quota: boolean;
}

const SPECIALTY_PROFILE: Record<string, StatProfile> = {
    B001: { grants_base: 60, threshold_base: 75, has_rural_quota: true },
    B002: { grants_base: 40, threshold_base: 70, has_rural_quota: true },
    B005: { grants_base: 80, threshold_base: 80, has_rural_quota: true },
    B006: { grants_base: 35, threshold_base: 72, has_rural_quota: true },
    B009: { grants_base: 70, threshold_base: 95, has_rural_quota: true },
    B010: { grants_base: 35, threshold_base: 92, has_rural_quota: true },
    B011: { grants_base: 80, threshold_base: 105, has_rural_quota: true },
    B012: { grants_base: 30, threshold_base: 90, has_rural_quota: true },
    B016: { grants_base: 45, threshold_base: 78, has_rural_quota: true },
    B041: { grants_base: 25, threshold_base: 100, has_rural_quota: false },
    B042: { grants_base: 20, threshold_base: 108, has_rural_quota: false },
    B044: { grants_base: 15, threshold_base: 102, has_rural_quota: false },
    B045: { grants_base: 12, threshold_base: 96, has_rural_quota: false },
    B046: { grants_base: 18, threshold_base: 98, has_rural_quota: false },
    B047: { grants_base: 30, threshold_base: 112, has_rural_quota: true },
    B048: { grants_base: 25, threshold_base: 118, has_rural_quota: false },
    B057: { grants_base: 100, threshold_base: 115, has_rural_quota: true },
    B058: { grants_base: 35, threshold_base: 110, has_rural_quota: true },
    B059: { grants_base: 60, threshold_base: 95, has_rural_quota: true },
    B062: { grants_base: 50, threshold_base: 88, has_rural_quota: true },
    B063: { grants_base: 60, threshold_base: 90, has_rural_quota: true },
    B071: { grants_base: 45, threshold_base: 82, has_rural_quota: true },
    B072: { grants_base: 55, threshold_base: 92, has_rural_quota: true },
    B084: { grants_base: 70, threshold_base: 122, has_rural_quota: true },
    B085: { grants_base: 25, threshold_base: 105, has_rural_quota: true },
    B086: { grants_base: 30, threshold_base: 95, has_rural_quota: true },
    B091: { grants_base: 20, threshold_base: 85, has_rural_quota: true },
    B094: { grants_base: 40, threshold_base: 75, has_rural_quota: true },
    B142: { grants_base: 20, threshold_base: 88, has_rural_quota: false },
    B148: { grants_base: 45, threshold_base: 82, has_rural_quota: true },
};

// Year-on-year noise so the seed produces a plausible trend rather than
// identical rows. Deterministic from (unik, code, year) so re-runs are stable.
function hash(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h = (h ^ s.charCodeAt(i)) * 16777619;
    }
    return Math.abs(h | 0);
}

function jitter(seed: string, range: number): number {
    return (hash(seed) % (range * 2 + 1)) - range;
}

const YEARS = [2023, 2024, 2025];

function parseArgs(argv: string[]): { dryRun: boolean; wipe: boolean } {
    let dryRun = false;
    let wipe = false;
    for (const arg of argv.slice(2)) {
        if (arg === '--dry-run') dryRun = true;
        else if (arg === '--wipe') wipe = true;
    }
    return { dryRun, wipe };
}

async function main(): Promise<void> {
    const { dryRun, wipe } = parseArgs(process.argv);
    const now = Math.floor(Date.now() / 1000);

    console.log(`[universities-kk] start — dryRun=${dryRun}, wipe=${wipe}`);

    if (wipe && !dryRun) {
        console.log('[universities-kk] wiping existing rows...');
        await prisma.admissionStat.deleteMany({});
        await prisma.universitySpecialty.deleteMany({});
        await prisma.university.deleteMany({});
        await prisma.specialty.deleteMany({});
    }

    // Pass 1 — specialties
    console.log(`[universities-kk] upsert ${SPECIALTIES.length} specialties...`);
    const specialtyByCode = new Map<string, number>();
    for (const s of SPECIALTIES) {
        if (dryRun) {
            console.log(`  · ${s.code} — ${s.title_kk}`);
            specialtyByCode.set(s.code, 0);
            continue;
        }
        const row = await prisma.specialty.upsert({
            where: { code: s.code },
            create: { code: s.code, title_kk: s.title_kk, created_at: now },
            update: { title_kk: s.title_kk, updated_at: now, deleted_at: null },
            select: { id: true },
        });
        specialtyByCode.set(s.code, Number(row.id));
    }

    // Pass 2 — universities
    console.log(`[universities-kk] upsert ${UNIVERSITIES.length} universities...`);
    const universityByUnik = new Map<string, number>();
    for (const u of UNIVERSITIES) {
        if (dryRun) {
            console.log(`  · ${u.unik} — ${u.title_kk} (city_id=${u.city_id})`);
            universityByUnik.set(u.unik, 0);
            continue;
        }
        const existing = await prisma.university.findFirst({
            where: { unik: u.unik },
            select: { id: true },
        });
        if (existing) {
            await prisma.university.update({
                where: { id: existing.id },
                data: {
                    city_id: u.city_id,
                    website: u.website ?? null,
                    phone: u.phone ?? null,
                    email: u.email ?? null,
                    instagram: u.instagram ?? null,
                    address: u.address ?? null,
                    has_dormitory: u.has_dormitory,
                    has_military_department: u.has_military_department,
                    title_kk: u.title_kk,
                    short_desc_kk: u.short_desc_kk,
                    full_desc_kk: u.full_desc_kk,
                    deleted_at: null,
                    updated_at: now,
                },
            });
            universityByUnik.set(u.unik, Number(existing.id));
        } else {
            const created = await prisma.university.create({
                data: {
                    unik: u.unik,
                    city_id: u.city_id,
                    website: u.website ?? null,
                    phone: u.phone ?? null,
                    email: u.email ?? null,
                    instagram: u.instagram ?? null,
                    address: u.address ?? null,
                    has_dormitory: u.has_dormitory,
                    has_military_department: u.has_military_department,
                    title_kk: u.title_kk,
                    short_desc_kk: u.short_desc_kk,
                    full_desc_kk: u.full_desc_kk,
                    created_at: now,
                },
                select: { id: true },
            });
            universityByUnik.set(u.unik, Number(created.id));
        }
    }

    // Pass 3 — university_specialties links
    const linkPairs: Array<{ unik: string; code: string }> = [];
    for (const [unik, codes] of Object.entries(UNIVERSITY_SPECIALTIES)) {
        for (const code of codes) linkPairs.push({ unik, code });
    }
    console.log(`[universities-kk] upsert ${linkPairs.length} university↔specialty links...`);
    const linkByPair = new Map<string, number>();
    for (const { unik, code } of linkPairs) {
        const universityId = universityByUnik.get(unik);
        const specialtyId = specialtyByCode.get(code);
        if (!universityId || !specialtyId) {
            console.warn(`  · skip ${unik}/${code} — missing fk`);
            continue;
        }
        const profile = SPECIALTY_PROFILE[code];
        if (dryRun) {
            linkByPair.set(`${unik}/${code}`, 0);
            continue;
        }
        const existing = await prisma.universitySpecialty.findFirst({
            where: { university_id: universityId, specialty_id: specialtyId },
            select: { id: true },
        });
        if (existing) {
            await prisma.universitySpecialty.update({
                where: { id: existing.id },
                data: {
                    has_rural_quota: profile?.has_rural_quota ?? false,
                    deleted_at: null,
                    updated_at: now,
                },
            });
            linkByPair.set(`${unik}/${code}`, Number(existing.id));
        } else {
            const created = await prisma.universitySpecialty.create({
                data: {
                    university_id: universityId,
                    specialty_id: specialtyId,
                    has_rural_quota: profile?.has_rural_quota ?? false,
                    short_desc_kk: null,
                    full_desc_kk: null,
                    created_at: now,
                },
                select: { id: true },
            });
            linkByPair.set(`${unik}/${code}`, Number(created.id));
        }
    }

    // Pass 4 — admission stats
    const statRows: Array<{ unik: string; code: string; year: number; grants: number; threshold: number; thresholdRural: number | null }> = [];
    for (const { unik, code } of linkPairs) {
        const profile = SPECIALTY_PROFILE[code];
        if (!profile) continue;
        // Per-university × specialty multiplier — flagship unis get more grants
        const flagshipMul = ['KAZNU', 'ENU', 'NU', 'KAZNTU', 'KIMEP', 'KAZNMU'].includes(unik) ? 1.6 : 0.8;
        for (const year of YEARS) {
            const seed = `${unik}/${code}/${year}`;
            const grants = Math.max(5, Math.round(profile.grants_base * flagshipMul + jitter(seed + ':g', 8)));
            const threshold = Math.min(140, Math.max(50, profile.threshold_base + jitter(seed + ':t', 4) + (year - 2023) * 2));
            const thresholdRural = profile.has_rural_quota
                ? Math.min(140, Math.max(40, threshold - 12 + jitter(seed + ':r', 3)))
                : null;
            statRows.push({ unik, code, year, grants, threshold, thresholdRural });
        }
    }
    console.log(`[universities-kk] upsert ${statRows.length} admission_stats rows (${YEARS.join(', ')})...`);
    for (const s of statRows) {
        const linkId = linkByPair.get(`${s.unik}/${s.code}`);
        if (!linkId) {
            console.warn(`  · skip ${s.unik}/${s.code}/${s.year} — missing link`);
            continue;
        }
        if (dryRun) {
            console.log(`  · ${s.unik}/${s.code}/${s.year} grants=${s.grants} t=${s.threshold} rural=${s.thresholdRural ?? '-'}`);
            continue;
        }
        await prisma.admissionStat.upsert({
            where: {
                uniq_admission_us_year: {
                    university_specialty_id: linkId,
                    year: s.year,
                },
            },
            create: {
                university_specialty_id: linkId,
                year: s.year,
                grants_count: s.grants,
                threshold: s.threshold,
                threshold_rural: s.thresholdRural,
                created_at: now,
            },
            update: {
                grants_count: s.grants,
                threshold: s.threshold,
                threshold_rural: s.thresholdRural,
                updated_at: now,
            },
        });
    }

    console.log('[universities-kk] done.');
}

main()
    .catch((err) => {
        console.error('[universities-kk] failed:', err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
