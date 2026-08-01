// Team primary colors, for the bracket tree's generated badge visuals
// (initials-in-a-circle standing in for real team logos - see
// TECHNICAL_NOTES.md for why we're not using actual logo assets).
//
// Sourced from teamcolorcodes.com, which cites each school's own official
// brand guidelines - these are real, verified colors, not guesses. Colors
// are listed in the order the source lists them (usually primary first);
// which one(s) actually get used for the badge fill/text is a rendering
// decision for later, not decided here - this file just holds the raw
// verified data.
//
// Being compiled incrementally in batches - see conversation history for
// the exact source pages. Not yet complete for all ~134 FBS teams.

const TEAM_COLORS = {
  // --- AAC ---
  'UCF': ['#FFC904', '#BA9B37', '#000000'], // bright gold, metallic gold, black
  'Cincinnati': ['#E00122', '#000000', '#FFFFFF'], // red, black, white
  'UConn': ['#000E2F', '#FFFFFF', '#7C878E', '#E4002B'], // navy, white, gray, red
  'East Carolina': ['#592A8A', '#FDC82F'], // purple, gold
  'Houston': ['#C8102E', '#76232F', '#B2B4B2'], // red, dark red, gray
  'Memphis': ['#003087', '#898D8D', '#F8992E'], // blue, gray, orange
  'Navy': ['#00205B', '#C5B783'], // navy, gold
  'SMU': ['#C8102E', '#0033A0'], // red, blue
  'Temple': ['#9D2235', '#FFCD00', '#8A8D8F', '#C1C6C8', '#000000', '#FFFFFF'], // cherry, yellow, metallic silver, silver, black, white
  'Tulane': ['#006747', '#43B02A', '#418FDE', '#FFFFFF', '#000000'], // dark green, kelly green, blue, white, black
  'Tulsa': ['#002D72', '#C8102E', '#C5B783', '#F3D54E', '#84754E'], // navy, red, old gold, yellow, metallic gold
  'USF': ['#006747', '#CFC493'], // green, gold

  // --- ACC ---
  'Boston College': ['#98002E', '#BC9B6A'], // maroon, gold
  'Clemson': ['#F56600', '#522D80'], // Clemson orange, regalia
  'Duke': ['#003087', '#FFFFFF'], // Duke blue, white
  'Florida State': ['#782F40', '#CEB888', '#FFFFFF', '#000000'], // garnet, gold, white, black
  'Georgia Tech': ['#B3A369', '#A28D5B', '#003057'], // Tech gold, metallic gold, blue
  'Louisville': ['#AD0000', '#000000', '#FDB913'], // red, black, yellow
  'Miami': ['#F47321', '#005030', '#FFFFFF'], // orange, green, white
  'North Carolina': ['#7BAFD4', '#FFFFFF'], // Carolina blue, white
  'NC State': ['#CC0000', '#000000', '#FFFFFF'], // red, black, white
  'Notre Dame': ['#0C2340', '#C99700', '#AE9142', '#00843D'], // Notre Dame blue, Standard Dome gold, metallic gold, Irish green
  'Pittsburgh': ['#003594', '#FFB81C'], // Game Royal, University gold
  'Syracuse': ['#F76900', '#FFFFFF', '#000E54'], // Syracuse orange, white, Primary blue
  'Virginia': ['#232D4B', '#F84C1E'], // Jefferson blue, Virginia orange
  'Virginia Tech': ['#630031', '#CF4420'], // maroon, burnt orange
  'Wake Forest': ['#9E7E38', '#000000'], // gold, black

  // --- Big Ten ---
  'Illinois': ['#13294B', '#E84A27'], // navy blue, orange
  'Indiana': ['#990000', '#EEEDEB'], // crimson, cream
  'Iowa': ['#000000', '#FFCD00'], // black, Hawkeyes gold
  'Maryland': ['#E03A3E', '#FFFFFF', '#000000', '#FFD520'], // red, white, black, gold
  'Michigan': ['#00274C', '#FFCB05'], // blue, maize
  'Michigan State': ['#18453B', '#FFFFFF'], // green, white
  'Minnesota': ['#7A0019', '#FFCC33'], // maroon, gold
  'Nebraska': ['#E41C38', '#000000', '#FFFFFF', '#FDF2D9'], // red, black, white, cream
  'Northwestern': ['#4E2A84', '#FFFFFF'], // purple, white
  'Ohio State': ['#BB0000', '#666666', '#FFFFFF', '#000000'], // scarlet, gray, white, black
  'Penn State': ['#041E42', '#FFFFFF'], // blue, white
  'Purdue': ['#CEB888', '#000000', '#9D968D', '#373A36', '#C28E0E'], // athletic gold, black, gray, dark gray, campus gold
  'Rutgers': ['#CC0033', '#5F6A72', '#000000'], // scarlet, gray, black
  'Wisconsin': ['#C5050C', '#FFFFFF'], // badger red, white

  // --- Big 12 ---
  'Baylor': ['#154734', '#FFB81C'], // Baylor green, Baylor gold
  'Iowa State': ['#C8102E', '#F1BE48'], // cardinal, gold
  'Kansas': ['#0051BA', '#E8000D', '#FFC82D', '#85898A'], // KU blue, crimson, Jayhawk yellow, Signature grey
  'Kansas State': ['#512888', '#D1D1D1', '#A7A7A7', '#FFFFFF', '#000000'], // purple, light gray, gray, white, black
  'Oklahoma': ['#841617', '#FDF9D8'], // crimson, cream
  'Oklahoma State': ['#FF7300', '#000000'], // orange, black
  'Texas': ['#BF5700', '#333F48', '#FFFFFF'], // burnt orange, dark gray, white
  'TCU': ['#4D1979', '#A3A9AC', '#FFFFFF'], // purple, grey, white
  'Texas Tech': ['#CC0000', '#000000'], // red, black
  'West Virginia': ['#002855', '#EAAA00'], // blue, gold

  // --- Conference USA ---
  'Charlotte': ['#046A38', '#B9975B', '#27251F', '#FFFFFF'], // green, gold, black, white
  'Florida Atlantic': ['#003366', '#CC0000', '#8A8D8F', '#CCCCCC'], // blue, red, silver, gray
  'Florida International': ['#081E3F', '#B6862C'], // navy blue, gold
  'Louisiana Tech': ['#002F8B', '#E31B23', '#A2AAAD', '#111111'], // blue, red, gray, black
  'Marshall': ['#00B140', '#A2AAAD'], // green, gray
  'Middle Tennessee': ['#000000', '#0066CC'], // black, blue
  'North Texas': ['#00853E', '#000000'], // UNT green, black
  'Old Dominion': ['#003057', '#7C878E'], // blue, gray
  'Rice': ['#00205B', '#C1C6C8'], // blue, gray
  'Southern Mississippi': ['#000000', '#FFAB00'], // black, gold
  'UAB': ['#006341', '#CC8A00', '#000000', '#BF0D3E'], // green, gold, black, red
  'UTEP': ['#FF8200', '#041E42', '#B1B3B3'], // orange, blue, silver
  'UTSA': ['#F15A22', '#0C2340'], // orange, blue
  'Western Kentucky': ['#C60C30', '#1E1E1E'], // red, dark gray/black

  // --- MAC ---
  'Akron': ['#041E42', '#A89968'],
  'Bowling Green': ['#FE5000', '#4F2C1D'],
  'Buffalo': ['#005BBB', '#FFFFFF'],
  'Kent State': ['#002664', '#EAAB00'],
  'Miami University': ['#B61E2E', '#000000'],
  'Ohio': ['#00694E', '#CDA077'],
  'Ball State': ['#BA0C2F', '#000000'],
  'Central Michigan': ['#6A0032', '#FFC82E'], // maroon, gold
  'Eastern Michigan': ['#006633', '#FFFFFF'],
  'Northern Illinois': ['#BA0C2F', '#8A8D8F'],
  'Toledo': ['#15397F', '#005CB9', '#FFDA00'],
  'Western Michigan': ['#6C4023', '#B5A167'],

  // --- Mountain West ---
  'Air Force': ['#003087', '#8A8D8F'], // blue, silver
  'Boise State': ['#0033A0', '#D64309'], // blue, orange
  'Colorado State': ['#1E4D2B', '#C8C372'], // green, gold
  'Fresno State': ['#DB0032', '#002E6D'],
  "Hawai'i": ['#024731', '#C8C8C8', '#000000'], // green, silver, black
  'Nevada': ['#003366', '#807F84'], // navy blue, gray
  'New Mexico': ['#BA0C2F', '#A7A8AA'],
  'San Diego State': ['#A6192E', '#000000', '#FFFFFF'], // red, black, white
  'San Jose State': ['#0055A2', '#E5A823', '#939597'], // blue, gold, gray
  'UNLV': ['#CF0A2C', '#CAC8C8'],
  'Utah State': ['#00263A', '#8A8D8F', '#000000', '#FFFFFF'], // Aggie blue, silver, black, white
  'Wyoming': ['#FFC425', '#492F24'], // Wyoming gold, Wyoming brown

  // --- Pac-12 ---
  'Arizona': ['#CC0033', '#003366'], // cardinal, navy
  'Arizona State': ['#8C1D40', '#FFC627'], // maroon, gold
  'California': ['#003262', '#3B7EA1', '#FDB515', '#C4820E'], // Berkeley blue, Founder's Rock, California gold, Medalist
  'Colorado': ['#CFB87C', '#000000', '#A2A4A3'], // gold, black, silver
  'Oregon': ['#154733', '#FEE123'], // Oregon green, yellow
  'Oregon State': ['#DC4405', '#000000', '#FFFFFF'], // Beaver orange, Paddletail black, Bucktooth white
  'Stanford': ['#8C1515', '#4D4F53', '#2E2D29', '#FFFFFF'], // red, cool gray, black, white
  'UCLA': ['#2D68C4', '#F2A900'], // blue, gold
  'USC': ['#990000', '#FFC72C'], // red, yellow
  'Utah': ['#CC0000', '#808080', '#000000'], // University red, gray, black
  'Washington': ['#4B2E83', '#B7A57A', '#85754D'], // purple, gold, metallic gold
  'Washington State': ['#981E32', '#5E6A71'], // crimson, gray

  // --- SEC ---
  'Alabama': ['#9E1B32', '#828A8F', '#FFFFFF'], // crimson, gray, white
  'Arkansas': ['#9D2235', '#FFFFFF'], // cardinal, white
  'Auburn': ['#0C2340', '#E87722'], // Auburn blue, Auburn orange
  'Florida': ['#0021A5', '#FA4616'], // blue, orange
  'Georgia': ['#BA0C2F', '#000000', '#FFFFFF'], // Bulldog red, Arch black, Chapel Bell white
  'Kentucky': ['#0033A0', '#FFFFFF', '#000000'], // Wildcat blue, white, black
  'LSU': ['#461D7C', '#FDD023'], // purple, gold
  'Ole Miss': ['#CE1126', '#14213D'], // red, navy blue
  'Mississippi State': ['#660000', '#FFFFFF'], // maroon, white
  'Missouri': ['#000000', '#F1B82D'], // black, gold
  'South Carolina': ['#73000A', '#000000'], // garnet, black
  'Tennessee': ['#FF8200', '#58595B', '#FFFFFF'], // Tennessee orange, smokey, white
  'Texas A&M': ['#500000', '#FFFFFF'], // maroon, white
  'Vanderbilt': ['#000000', '#866D4B'], // black, gold

  // --- Sun Belt ---
  'Appalachian State': ['#222222', '#FFCC00'], // black, yellow
  'Arkansas State': ['#CC092F', '#000000'],
  'Coastal Carolina': ['#006F71', '#A27752', '#111111'], // teal, gold, black
  'Georgia Southern': ['#011E41', '#A3AAAE', '#87714D'], // blue, gray, old gold
  'Georgia State': ['#0039A6', '#C60C30'],
  'Louisiana': ['#CE181E', '#0A0203'],
  'UL Monroe': ['#840029', '#FDB913'], // Warhawk maroon, Heritage gold
  'South Alabama': ['#00205B', '#BF0D3E', '#FFFFFF'], // blue, red, white
  'Texas State': ['#501214', '#8D734A'],
  'Troy': ['#8A2432', '#B3B5B8'],

  // --- Independents / other ---
  'Army': ['#D4BF91', '#B2B4B3', '#000000'], // gold, gray, black
  'BYU': ['#002E5D', '#0062B8', '#FFFFFF'], // blue, royal, white
  'Delaware': ['#00539F', '#FFDD31'],
  'James Madison': ['#450084', '#CBB677'],
  'Kennesaw State': ['#FDBB30', '#0B1315'],
  'Liberty': ['#002D62', '#C41230'],
  'Missouri State': ['#5E0009', '#FFFFFF'],
  'New Mexico State': ['#861F41', '#97999B'],
  'North Dakota State': ['#0A5640', '#FFC72A'], // green, yellow
  'Sacramento State': ['#043927', '#C4B581'],
  'Sam Houston': ['#FE5100', '#FFFFFF'],
  'UMass': ['#840028', '#212721'], // maroon, black (per UMass's own site - corrected from a bad duplicate-maroon entry)
  'Jacksonville State': ['#CC0000', '#FFFFFF'],
};

module.exports = { TEAM_COLORS };
