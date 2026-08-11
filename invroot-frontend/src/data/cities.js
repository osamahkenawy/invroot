/**
 * Cities by ISO country code, for the Settings → Company city picker.
 *
 * Bundled rather than fetched on purpose. A city lookup is a network call on a
 * form people fill in once, behind a login, sometimes on hotel wifi — and the
 * failure mode of a remote list is a field that silently offers nothing. This
 * is static data that cannot fail to load, cost a request, or leak which
 * tenant is typing.
 *
 * Deliberately NOT exhaustive, and the picker is built to accept a value that
 * isn't here: the GCC is covered properly because that is who Invroot is sold
 * to, and everywhere else lists the cities a business is most likely to be
 * registered in. A dropdown that cannot express your address is worse than the
 * plain text box this replaced, so CitySelect always allows a typed value.
 *
 * Sorted alphabetically per country; the picker relies on that order.
 */
const CITIES = {
  /* ── GCC — the home market, covered properly ─────────── */
  AE: [
    'Abu Dhabi', 'Ajman', 'Al Ain', 'Dhaid', 'Dibba Al-Fujairah', 'Dubai',
    'Fujairah', 'Ghayathi', 'Hatta', 'Jebel Ali', 'Khalifa City', 'Khor Fakkan',
    'Kalba', 'Liwa Oasis', 'Madinat Zayed', 'Masafi', 'Mussafah', 'Ras Al Khaimah',
    'Ruwais', 'Sharjah', 'Umm Al Quwain', 'Yas Island', 'Zayed City',
  ],
  SA: [
    'Abha', 'Al Bahah', 'Al Hofuf', 'Al Jubail', 'Al Khobar', 'Al Kharj',
    'Al Qatif', 'Arar', 'Buraydah', 'Dammam', 'Dhahran', 'Hail', 'Jazan',
    'Jeddah', 'Khamis Mushait', 'King Abdullah Economic City', 'Mecca', 'Medina',
    'Najran', 'NEOM', 'Qassim', 'Riyadh', 'Sakaka', 'Tabuk', 'Taif', 'Yanbu',
  ],
  KW: [
    'Al Ahmadi', 'Al Farwaniyah', 'Al Jahra', 'Fahaheel', 'Hawalli',
    'Kuwait City', 'Mangaf', 'Mubarak Al-Kabeer', 'Salmiya', 'Sabah Al Salem',
  ],
  QA: [
    'Al Khor', 'Al Rayyan', 'Al Shamal', 'Al Wakrah', 'Doha', 'Dukhan',
    'Lusail', 'Mesaieed', 'Umm Salal',
  ],
  BH: [
    'A‘ali', 'Budaiya', 'Hamad Town', 'Isa Town', 'Jidhafs', 'Manama',
    'Muharraq', 'Riffa', 'Sitra', 'Zallaq',
  ],
  OM: [
    'Barka', 'Bahla', 'Duqm', 'Ibri', 'Ibra', 'Muscat', 'Nizwa', 'Rustaq',
    'Salalah', 'Seeb', 'Sohar', 'Sur',
  ],

  /* ── Wider MENA ──────────────────────────────────────── */
  EG: ['6th of October City', 'Alexandria', 'Aswan', 'Asyut', 'Cairo', 'Giza',
       'Hurghada', 'Ismailia', 'Luxor', 'Mansoura', 'New Cairo', 'Port Said',
       'Sharm El Sheikh', 'Suez', 'Tanta'],
  JO: ['Amman', 'Aqaba', 'Irbid', 'Jerash', 'Madaba', 'Salt', 'Zarqa'],
  LB: ['Baalbek', 'Beirut', 'Byblos', 'Jounieh', 'Sidon', 'Tripoli', 'Tyre', 'Zahle'],
  IQ: ['Baghdad', 'Basra', 'Erbil', 'Karbala', 'Kirkuk', 'Mosul', 'Najaf', 'Sulaymaniyah'],
  MA: ['Agadir', 'Casablanca', 'Fes', 'Marrakesh', 'Meknes', 'Oujda', 'Rabat', 'Tangier'],
  TN: ['Bizerte', 'Gabes', 'Kairouan', 'Sfax', 'Sousse', 'Tunis'],
  DZ: ['Algiers', 'Annaba', 'Batna', 'Constantine', 'Oran', 'Setif'],
  LY: ['Benghazi', 'Misrata', 'Sabha', 'Tripoli', 'Zawiya'],
  YE: ['Aden', 'Al Hudaydah', 'Ibb', 'Mukalla', 'Sanaa', 'Taiz'],
  SY: ['Aleppo', 'Damascus', 'Hama', 'Homs', 'Latakia', 'Tartus'],
  TR: ['Adana', 'Ankara', 'Antalya', 'Bursa', 'Gaziantep', 'Istanbul', 'Izmir',
       'Kayseri', 'Konya', 'Mersin'],

  /* ── Asia ────────────────────────────────────────────── */
  IN: ['Ahmedabad', 'Bengaluru', 'Chandigarh', 'Chennai', 'Coimbatore', 'Delhi',
       'Gurugram', 'Hyderabad', 'Indore', 'Jaipur', 'Kochi', 'Kolkata', 'Lucknow',
       'Mumbai', 'Nagpur', 'Noida', 'Pune', 'Surat', 'Thiruvananthapuram', 'Vadodara'],
  PK: ['Faisalabad', 'Gujranwala', 'Hyderabad', 'Islamabad', 'Karachi', 'Lahore',
       'Multan', 'Peshawar', 'Quetta', 'Rawalpindi', 'Sialkot'],
  BD: ['Chattogram', 'Dhaka', 'Khulna', 'Rajshahi', 'Sylhet'],
  LK: ['Colombo', 'Galle', 'Jaffna', 'Kandy', 'Negombo'],
  NP: ['Biratnagar', 'Bharatpur', 'Kathmandu', 'Lalitpur', 'Pokhara'],
  PH: ['Cagayan de Oro', 'Cebu City', 'Davao City', 'Iloilo City', 'Makati',
       'Manila', 'Quezon City', 'Taguig'],
  ID: ['Bandung', 'Batam', 'Denpasar', 'Jakarta', 'Medan', 'Semarang', 'Surabaya'],
  MY: ['George Town', 'Ipoh', 'Johor Bahru', 'Kota Kinabalu', 'Kuala Lumpur',
       'Kuching', 'Malacca City', 'Putrajaya', 'Shah Alam'],
  SG: ['Singapore'],
  TH: ['Bangkok', 'Chiang Mai', 'Hat Yai', 'Pattaya', 'Phuket'],
  VN: ['Da Nang', 'Haiphong', 'Hanoi', 'Ho Chi Minh City', 'Nha Trang'],
  CN: ['Beijing', 'Chengdu', 'Chongqing', 'Guangzhou', 'Hangzhou', 'Nanjing',
       'Qingdao', 'Shanghai', 'Shenzhen', 'Suzhou', 'Tianjin', 'Wuhan', 'Xi’an'],
  JP: ['Fukuoka', 'Hiroshima', 'Kobe', 'Kyoto', 'Nagoya', 'Osaka', 'Sapporo',
       'Sendai', 'Tokyo', 'Yokohama'],
  KR: ['Busan', 'Daegu', 'Daejeon', 'Gwangju', 'Incheon', 'Seoul', 'Ulsan'],
  HK: ['Hong Kong'],

  /* ── Europe ──────────────────────────────────────────── */
  GB: ['Belfast', 'Birmingham', 'Bristol', 'Cardiff', 'Edinburgh', 'Glasgow',
       'Leeds', 'Liverpool', 'London', 'Manchester', 'Newcastle upon Tyne',
       'Nottingham', 'Sheffield'],
  IE: ['Cork', 'Dublin', 'Galway', 'Limerick', 'Waterford'],
  DE: ['Berlin', 'Bremen', 'Cologne', 'Dortmund', 'Dresden', 'Dusseldorf',
       'Essen', 'Frankfurt', 'Hamburg', 'Hanover', 'Leipzig', 'Munich',
       'Nuremberg', 'Stuttgart'],
  FR: ['Bordeaux', 'Lille', 'Lyon', 'Marseille', 'Montpellier', 'Nantes',
       'Nice', 'Paris', 'Strasbourg', 'Toulouse'],
  ES: ['Barcelona', 'Bilbao', 'Madrid', 'Malaga', 'Palma', 'Seville', 'Valencia', 'Zaragoza'],
  IT: ['Bologna', 'Florence', 'Genoa', 'Milan', 'Naples', 'Palermo', 'Rome', 'Turin', 'Venice'],
  NL: ['Amsterdam', 'Eindhoven', 'Groningen', 'Rotterdam', 'The Hague', 'Utrecht'],
  BE: ['Antwerp', 'Bruges', 'Brussels', 'Charleroi', 'Ghent', 'Liege'],
  CH: ['Basel', 'Bern', 'Geneva', 'Lausanne', 'Lugano', 'Zurich'],
  AT: ['Graz', 'Innsbruck', 'Linz', 'Salzburg', 'Vienna'],
  SE: ['Gothenburg', 'Malmo', 'Stockholm', 'Uppsala'],
  NO: ['Bergen', 'Oslo', 'Stavanger', 'Trondheim'],
  DK: ['Aalborg', 'Aarhus', 'Copenhagen', 'Odense'],
  FI: ['Espoo', 'Helsinki', 'Tampere', 'Turku'],
  PL: ['Gdansk', 'Katowice', 'Krakow', 'Lodz', 'Poznan', 'Warsaw', 'Wroclaw'],
  PT: ['Braga', 'Coimbra', 'Faro', 'Lisbon', 'Porto'],
  GR: ['Athens', 'Heraklion', 'Larissa', 'Patras', 'Thessaloniki'],
  CZ: ['Brno', 'Ostrava', 'Plzen', 'Prague'],
  RO: ['Bucharest', 'Cluj-Napoca', 'Constanta', 'Iasi', 'Timisoara'],
  RU: ['Kazan', 'Moscow', 'Nizhny Novgorod', 'Novosibirsk', 'Saint Petersburg',
       'Yekaterinburg'],
  UA: ['Dnipro', 'Kharkiv', 'Kyiv', 'Lviv', 'Odesa'],

  /* ── Americas ────────────────────────────────────────── */
  US: ['Atlanta', 'Austin', 'Boston', 'Charlotte', 'Chicago', 'Dallas', 'Denver',
       'Detroit', 'Houston', 'Las Vegas', 'Los Angeles', 'Miami', 'Minneapolis',
       'Nashville', 'New York', 'Orlando', 'Philadelphia', 'Phoenix', 'Portland',
       'San Diego', 'San Francisco', 'San Jose', 'Seattle', 'Washington'],
  CA: ['Calgary', 'Edmonton', 'Halifax', 'Hamilton', 'Montreal', 'Ottawa',
       'Quebec City', 'Toronto', 'Vancouver', 'Winnipeg'],
  MX: ['Cancun', 'Guadalajara', 'Mexico City', 'Monterrey', 'Puebla', 'Tijuana'],
  BR: ['Belo Horizonte', 'Brasilia', 'Curitiba', 'Fortaleza', 'Porto Alegre',
       'Recife', 'Rio de Janeiro', 'Salvador', 'Sao Paulo'],
  AR: ['Buenos Aires', 'Cordoba', 'La Plata', 'Mendoza', 'Rosario'],
  CL: ['Antofagasta', 'Concepcion', 'Santiago', 'Valparaiso'],
  CO: ['Barranquilla', 'Bogota', 'Cali', 'Cartagena', 'Medellin'],

  /* ── Africa ──────────────────────────────────────────── */
  ZA: ['Bloemfontein', 'Cape Town', 'Durban', 'Johannesburg', 'Port Elizabeth',
       'Pretoria'],
  NG: ['Abuja', 'Benin City', 'Ibadan', 'Kano', 'Lagos', 'Port Harcourt'],
  KE: ['Eldoret', 'Kisumu', 'Mombasa', 'Nairobi', 'Nakuru'],
  GH: ['Accra', 'Kumasi', 'Takoradi', 'Tamale'],
  ET: ['Addis Ababa', 'Bahir Dar', 'Dire Dawa', 'Mekelle'],
  TZ: ['Arusha', 'Dar es Salaam', 'Dodoma', 'Mwanza'],
  UG: ['Entebbe', 'Gulu', 'Jinja', 'Kampala'],
  SN: ['Dakar', 'Saint-Louis', 'Thies', 'Touba'],

  /* ── Oceania ─────────────────────────────────────────── */
  AU: ['Adelaide', 'Brisbane', 'Canberra', 'Darwin', 'Gold Coast', 'Hobart',
       'Melbourne', 'Newcastle', 'Perth', 'Sydney'],
  NZ: ['Auckland', 'Christchurch', 'Dunedin', 'Hamilton', 'Wellington'],
};

/** Cities for a country code, or [] when we don't carry a list for it. */
export function citiesFor(code) {
  return CITIES[String(code || '').toUpperCase()] || [];
}

export default CITIES;
