# The new airports worklist

Generated from `api/_data/airport-targets.json` diffed against the live
Airports table on 26 August 2026, then pre-flighted against OurAirports. Not
typed by hand and not copied from an earlier count.

## Where the number comes from

| | |
|---|---:|
| Committed target list | 475 |
| Already in the table | 225 |
| Targets already covered | 182 |
| **Targets still to create** | **293** |

The plan's headline figure of 368 is this 293 plus the airports our own
destination prose already names in parentheses, which the breadth detector
finds at run time by scanning the Countries, Cities and Theme Parks tables. That
part of the worklist is computed on each run rather than frozen here, because
the prose changes.

## Pre-flight against source 1

Every one of the 293 was looked up in OurAirports using the repo's own parser,
not a reimplementation.

| Check | Result |
|---|---|
| Present in OurAirports | 293 of 293 |
| Absent | none |
| `scheduled_service` not yes | none |
| Not a large, medium or small airport | none |
| Missing a municipality | none |
| Missing coordinates | none |

So source 1 covers the whole run and nothing should come back "not in
OurAirports". Whether each record is actually created still depends on Wikidata
corroborating it, field by field, which happens on the deploy.

## Spread

| Continent | New records |
|---|---:|
| Asia | 108 |
| North America | 77 |
| Europe | 53 |
| South America | 24 |
| Africa | 23 |
| Oceania | 8 |
| **Total** | **293** |

Heaviest countries: US 56, CN 46, BR 15, RU 11, DE 9, IT 8, IN 7, JP 6, MX 6, CA 5, FR 5, ID 4.

## The list

Grouped by continent, then by IATA code. Name and city are the OurAirports
values, shown so a wrong code is obvious on sight. Neither is written to a
record unless Wikidata corroborates it too.

### Europe (53)

| IATA | Name | City | Country |
|---|---|---|---|
| BEG | Belgrade Nikola Tesla Airport | Belgrade | RS |
| BGO | Bergen Airport, Flesland | Bergen | NO |
| BIA | Bastia-Poretta International airport | Bastia | FR |
| BLL | Billund Airport | Billund | DK |
| BLQ | Bologna Guglielmo Marconi Airport | Bologna | IT |
| BRE | Bremen Airport | Bremen | DE |
| BRI | Bari Karol Wojtyła International Airport | Bari | IT |
| BRU | Brussels Airport | Zaventem | BE |
| BVA | Beauvais-Tillé airport | Beauvais | FR |
| CAG | Cagliari Elmas Airport | Cagliari | IT |
| CGN | Cologne Bonn Airport | Köln (Cologne) | DE |
| CRL | Brussels South Charleroi Airport | Charleroi | BE |
| DME | Domodedovo International Airport | Moscow | RU |
| DTM | Dortmund Airport | Dortmund | DE |
| FLR | Florence Airport, Peretola | Firenze (FI) | IT |
| GDN | Gdańsk Lech Wałęsa Airport | Gdańsk | PL |
| GOT | Göteborg Landvetter Airport | Göteborg | SE |
| GRO | Girona-Costa Brava Airport | Girona | ES |
| HAJ | Hannover Airport | Hannover | DE |
| HHN | Frankfurt-Hahn Airport | Frankfurt am Main (Lautzenhausen) | DE |
| KRK | Kraków John Paul II International Airport | Balice | PL |
| KRR | Krasnodar Pashkovsky International Airport | Krasnodar | RU |
| KTW | Katowice Wojciech Korfanty International Airport | Katowice | PL |
| LED | Pulkovo Airport | St. Petersburg | RU |
| LEJ | Leipzig/Halle Airport | Schkeuditz | DE |
| LIL | Lille Airport | Lesquin | FR |
| LJU | Ljubljana Jože Pučnik Airport | Zgornji Brnik | SI |
| LUX | Luxembourg-Findel International Airport | Luxembourg | LU |
| MSQ | Minsk National Airport | Minsk | BY |
| NRN | Weeze (Niederrhein) Airport | Weeze | DE |
| NTE | Nantes Atlantique Airport | Nantes | FR |
| NUE | Nuremberg Airport | Nuremberg | DE |
| NYO | Stockholm Skavsta Airport | Nyköping | SE |
| OTP | Bucharest Henri Coandă International Airport | Otopeni | RO |
| OVB | Novosibirsk Tolmachevo Airport | Novosibirsk | RU |
| PMO | Falcone–Borsellino Airport | Palermo | IT |
| RIX | Riga International Airport | Riga | LV |
| RTM | Rotterdam The Hague Airport | Rotterdam | NL |
| SCQ | Santiago-Rosalía de Castro Airport | Santiago de Compostela | ES |
| SOF | Sofia Airport | Sofia | BG |
| STR | Stuttgart Airport | Stuttgart | DE |
| SVG | Stavanger Airport, Sola | Stavanger | NO |
| SVO | Sheremetyevo International Airport | Moscow | RU |
| SXB | Strasbourg Airport | Strasbourg | FR |
| TLL | Lennart Meri Tallinn Airport | Tallinn | EE |
| TRD | Trondheim Airport, Værnes | Trondheim | NO |
| TRF | Sandefjord Airport, Torp | Sandefjord(Torp) | NO |
| TRN | Turin Airport | Caselle Torinese (TO) | IT |
| TSF | Treviso Airport | Treviso (TV) | IT |
| VKO | Vnukovo International Airport | Moscow | RU |
| VNO | Vilnius International Airport | Vilnius | LT |
| VRN | Verona Villafranca Valerio Catullo Airport | Caselle (VR) | IT |
| WRO | Copernicus Wrocław Airport | Wrocław | PL |

### Asia (108)

| IATA | Name | City | Country |
|---|---|---|---|
| ADB | Adnan Menderes International Airport | Gaziemir | TR |
| ALA | Almaty International Airport | Almaty | KZ |
| AMD | Sardar Vallabh Patel International Airport | Ahmedabad | IN |
| BAV | Baotou Donghe International Airport | Baotou | CN |
| BEY | Beirut Rafic Hariri International Airport | Beirut | LB |
| BKI | Kota Kinabalu International Airport | Kota Kinabalu | MY |
| BPN | Sultan Aji Muhammad Sulaiman Sepinggan International Airport | Balikpapan | ID |
| BTH | Hang Nadim International Airport | Batam | ID |
| CAN | Guangzhou Baiyun International Airport | Guangzhou (Huadu) | CN |
| CCJ | Calicut International Airport | Calicut | IN |
| CCU | Netaji Subhash Chandra Bose International Airport | Kolkata | IN |
| CEB | Mactan Cebu International Airport | Cebu City/Lapu-Lapu City | PH |
| CGO | Zhengzhou Xinzheng International Airport | Zhengzhou | CN |
| CGQ | Changchun Longjia International Airport | Changchun | CN |
| CJU | Jeju International Airport | Jeju City | KR |
| CKG | Chongqing Jiangbei International Airport | Chongqing | CN |
| CSX | Changsha Huanghua International Airport | Changsha (Changsha) | CN |
| CTS | New Chitose Airport | Sapporo | JP |
| CTU | Chengdu Shuangliu International Airport | Chengdu (Shuangliu) | CN |
| DAC | Hazrat Shahjalal International Airport | Dhaka | BD |
| DLC | Dalian Zhoushuizi International Airport | Dalian (Ganjingzi) | CN |
| DMM | King Fahd International Airport | Ad Dammam | SA |
| DYU | Dushanbe International Airport | Dushanbe | TJ |
| EBL | Erbil International Airport | Arbil | IQ |
| ESB | Esenboğa International Airport | Ankara | TR |
| EVN | Zvartnots International Airport | Yerevan | AM |
| FOC | Fuzhou Changle International Airport | Fuzhou (Changle) | CN |
| FUK | Fukuoka Airport | Fukuoka | JP |
| GAU | Lokpriya Gopinath Bordoloi International Airport | Guwahati | IN |
| GMP | Seoul Gimpo International Airport | Seoul | KR |
| GYD | Heydar Aliyev International Airport | Baku | AZ |
| HAK | Haikou Meilan International Airport | Haikou (Meilan) | CN |
| HET | Hohhot Baita International Airport | Hohhot | CN |
| HFE | Hefei Xinqiao International Airport | Hefei | CN |
| HGH | Hangzhou Xiaoshan International Airport | Hangzhou | CN |
| HRB | Harbin Taiping International Airport | Harbin | CN |
| HYD | Rajiv Gandhi International Airport | Hyderabad | IN |
| IKA | Imam Khomeini International Airport | Tehran | IR |
| IKT | Irkutsk International Airport | Irkutsk | RU |
| INC | Yinchuan Hedong International Airport | Yinchuan | CN |
| ISB | Islamabad International Airport | Attock | PK |
| ITM | Osaka Itami International Airport | Osaka | JP |
| JJN | Quanzhou Jinjiang International Airport | Quanzhou | CN |
| KHH | Kaohsiung International Airport | Kaohsiung (Xiaogang) | TW |
| KHI | Jinnah International Airport | Karachi | PK |
| KHN | Nanchang Changbei International Airport | Nanchang | CN |
| KJA | Krasnoyarsk International Airport | Krasnoyarsk | RU |
| KMG | Kunming Changshui International Airport | Kunming | CN |
| KTM | Tribhuvan International Airport | Kathmandu | NP |
| KWE | Guiyang Longdongbao International Airport | Guiyang (Nanming) | CN |
| KWI | Kuwait International Airport | Kuwait City | KW |
| KWL | Guilin Liangjiang International Airport | Guilin (Lingui) | CN |
| KZN | Kazan International Airport | Kazan | RU |
| LBD | Khujand International Airport | Khujand | TJ |
| LHE | Allama Iqbal International Airport | Lahore | PK |
| LHW | Lanzhou Zhongchuan International Airport | Lanzhou (Yongdeng) | CN |
| LJG | Lijiang Sanyi International Airport | Lijiang | CN |
| LXA | Lhasa Gonggar International Airport | Shannan (Gonggar) | CN |
| MED | Prince Mohammad Bin Abdulaziz Airport | Medina | SA |
| MFM | Macau International Airport | Nossa Senhora do Carmo | MO |
| MHD | Mashhad International Airport | Mashhad | IR |
| MNL | Ninoy Aquino International Airport | Manila (Pasay) | PH |
| NGB | Ningbo Lishe International Airport | Ningbo | CN |
| NGO | Chubu Centrair International Airport | Tokoname | JP |
| NKG | Nanjing Lukou International Airport | Nanjing | CN |
| NNG | Nanning Wuxu International Airport | Nanning (Jiangnan) | CN |
| OKA | Naha International Airport | Naha | JP |
| OSS | Osh International Airport | Osh | KG |
| PEN | Penang International Airport | Penang | MY |
| PEW | Bacha Khan International Airport | Peshawar | PK |
| PNQ | Pune International Airport | Pune | IN |
| PUS | Gimhae International Airport | Busan | KR |
| RGN | Yangon International Airport | Yangon | MM |
| RMQ | Taichung International Airport / Ching Chuang Kang Air Base | Taichung (Qingshui) | TW |
| SAH | Sanaa International Airport | Sanaa | YE |
| SDJ | Sendai Airport | Natori | JP |
| SHA | Shanghai Hongqiao International Airport | Shanghai (Minhang) | CN |
| SHE | Shenyang Taoxian International Airport | Shenyang | CN |
| SJW | Shijiazhuang Zhengding International Airport | Shijiazhuang | CN |
| SUB | Juanda International Airport | Surabaya | ID |
| SVX | Koltsovo Airport | Yekaterinburg | RU |
| SWA | Jieyang Chaoshan International Airport | Jieyang (Rongcheng) | CN |
| SYX | Sanya Phoenix International Airport | Sanya (Tianya) | CN |
| SYZ | Shiraz Shahid Dastghaib International Airport | Shiraz | IR |
| SZB | Sultan Abdul Aziz Shah International Airport | Subang | MY |
| SZX | Shenzhen Bao'an International Airport | Shenzhen | CN |
| TAO | Qingdao Jiaodong International Airport | Qingdao (Jiaozhou) | CN |
| TAS | Tashkent International Airport | Tashkent | UZ |
| TBS | Tbilisi International Airport | Tbilisi | GE |
| THR | Mehrabad International Airport | Tehran | IR |
| TNA | Jinan Yaoqiang International Airport | Jinan (Licheng) | CN |
| TPE | Taiwan Taoyuan International Airport | Taoyuan | TW |
| TRV | Thiruvananthapuram International Airport | Thiruvananthapuram | IN |
| TSA | Taipei Songshan International Airport | Taipei (Songshan) | TW |
| TSN | Tianjin Binhai International Airport | Tianjin | CN |
| TYN | Taiyuan Wusu International Airport | Taiyuan | CN |
| UPG | Sultan Hasanuddin International Airport | Makassar | ID |
| URC | Ürümqi Tianshan International Airport | Ürümqi | CN |
| WNZ | Wenzhou Longwan International Airport | Wenzhou (Longwan) | CN |
| WUH | Wuhan Tianhe International Airport | Wuhan (Huangpi) | CN |
| WUX | Sunan Shuofang International Airport | Wuxi | CN |
| XIY | Xi'an Xianyang International Airport | Xi'an | CN |
| XMN | Xiamen Gaoqi International Airport | Xiamen | CN |
| XNN | Xining Caojiabao International Airport | Haidong (Huzhu Tu Autonomous County) | CN |
| YCU | Yuncheng Yanhu International Airport | Yuncheng (Yanhu) | CN |
| YKS | Platon Oyunsky Yakutsk International Airport | Yakutsk | RU |
| YNT | Yantai Penglai International Airport | Yantai | CN |
| ZUH | Zhuhai Jinwan Airport | Zhuhai (Jinwan) | CN |

### North America (77)

| IATA | Name | City | Country |
|---|---|---|---|
| ABQ | Albuquerque International Sunport | Albuquerque | US |
| ALB | Albany International Airport | Albany | US |
| ANC | Ted Stevens Anchorage International Airport | Anchorage | US |
| AUS | Austin Bergstrom International Airport | Austin | US |
| BDL | Bradley International Airport | Hartford | US |
| BHM | Birmingham-Shuttlesworth International Airport | Birmingham | US |
| BUF | Buffalo Niagara International Airport | Buffalo | US |
| BWI | Baltimore/Washington International Thurgood Marshall Airport | Baltimore | US |
| BZE | Philip S. W. Goldson International Airport | Belize City | BZ |
| CHS | Charleston International Airport | Charleston | US |
| CLE | Cleveland Hopkins International Airport | Cleveland | US |
| CMH | John Glenn Columbus International Airport | Columbus | US |
| CVG | Cincinnati Northern Kentucky International Airport | Cincinnati / Covington | US |
| DAL | Dallas Love Field | Dallas | US |
| DCA | Ronald Reagan Washington National Airport | Washington | US |
| DEN | Denver International Airport | Denver | US |
| DSM | Des Moines International Airport | Des Moines | US |
| DTW | Detroit Metropolitan Wayne County Airport | Detroit | US |
| GDL | Guadalajara International Airport | Guadalajara | MX |
| GRR | Gerald R. Ford International Airport | Grand Rapids | US |
| GUA | La Aurora International Airport | Guatemala City | GT |
| HOU | William P. Hobby Airport | Houston | US |
| IAH | George Bush Intercontinental Airport | Houston | US |
| IND | Indianapolis International Airport | Indianapolis | US |
| JAX | Jacksonville International Airport | Jacksonville | US |
| MCI | Kansas City International Airport | Kansas City | US |
| MDW | Chicago Midway International Airport | Chicago | US |
| MEM | Frederick W. Smith International Airport | Memphis | US |
| MEX | Mexico City Benito Juárez International Airport | Mexico City | MX |
| MKE | General Mitchell International Airport | Milwaukee | US |
| MSP | Minneapolis–Saint Paul International Airport / Wold–Chamberlain Field | Minneapolis | US |
| MSY | Louis Armstrong New Orleans International Airport | New Orleans | US |
| MTY | Monterrey International Airport | Monterrey | MX |
| MYR | Myrtle Beach International Airport | Myrtle Beach | US |
| OAK | Oakland San Francisco Bay Airport | Oakland | US |
| OKC | OKC Will Rogers World Airport | Oklahoma City | US |
| OMA | Eppley Airfield | Omaha | US |
| ORF | Norfolk International Airport | Norfolk | US |
| PDX | Portland International Airport | Portland | US |
| PHX | Phoenix Sky Harbor International Airport | Phoenix | US |
| PIE | St. Petersburg Clearwater International Airport | Pinellas Park | US |
| PIT | Pittsburgh International Airport | Pittsburgh | US |
| PLS | Providenciales International Airport | Providenciales | TC |
| POS | Piarco International Airport | Port of Spain | TT |
| PTP | Maryse Condé International Airport | Pointe-à-Pitre | GP |
| PTY | Tocumen International Airport | Tocumen | PA |
| PVD | Rhode Island T. F. Green International Airport | Providence/Warwick | US |
| PVR | Puerto Vallarta International Airport | Puerto Vallarta | MX |
| RDU | Raleigh-Durham International Airport | Raleigh/Durham | US |
| RIC | Richmond International Airport | Richmond | US |
| RNO | Reno Tahoe International Airport | Reno | US |
| ROC | Frederick Douglass Greater Rochester International Airport | Rochester | US |
| RSW | Southwest Florida International Airport | Fort Myers | US |
| SAL | El Salvador International Airport Saint Óscar Arnulfo Romero y Galdámez | San Salvador (San Luis Talpa) | SV |
| SAN | San Diego International Airport | San Diego | US |
| SAT | San Antonio International Airport | San Antonio | US |
| SDF | Louisville Muhammad Ali International Airport | Louisville | US |
| SDQ | Las Américas International Airport | Santo Domingo | DO |
| SJC | Mineta San Jose International Airport | San Jose | US |
| SJD | Los Cabos International Airport | San José del Cabo | MX |
| SJO | Juan Santamaría International Airport | San José (Alajuela) | CR |
| SJU | Luis Munoz Marin International Airport | San Juan | PR |
| SLC | Salt Lake City International Airport | Salt Lake City | US |
| SMF | Sacramento International Airport | Sacramento | US |
| SNA | John Wayne Orange County International Airport | Santa Ana | US |
| STL | St. Louis Lambert International Airport | St Louis | US |
| STT | Cyril E. King Airport | Charlotte Amalie | VI |
| SXM | Princess Juliana International Airport | Sint Maarten | SX |
| TIJ | General Abelardo L. Rodriguez International Airport | Tijuana | MX |
| TUL | Tulsa International Airport | Tulsa | US |
| TUS | Tucson International Airport | Tucson | US |
| TYS | McGhee Tyson Airport | Knoxville/Maryville | US |
| YEG | Edmonton International Airport | Edmonton | CA |
| YHZ | Halifax / Stanfield International Airport | Halifax | CA |
| YOW | Ottawa Macdonald-Cartier International Airport | Ottawa | CA |
| YQB | Quebec Jean Lesage International Airport | Quebec | CA |
| YWG | Winnipeg / James Armstrong Richardson International Airport | Winnipeg | CA |

### South America (24)

| IATA | Name | City | Country |
|---|---|---|---|
| AEP | Aeroparque Jorge Newbery | Buenos Aires | AR |
| BEL | Val de Cans/Júlio Cezar Ribeiro International Airport | Belém | BR |
| BOG | El Dorado International Airport | Bogota | CO |
| BSB | Presidente Juscelino Kubitschek International Airport | Brasília | BR |
| CCS | Maiquetía Simón Bolívar International Airport | Maiquetía | VE |
| CGB | Várzea Grande–Marechal Rondon International Airport | Cuiabá | BR |
| CGH | Congonhas–Deputado Freitas Nobre Airport | São Paulo | BR |
| CLO | Alfonso Bonilla Aragon International Airport | Cali | CO |
| CNF | Tancredo Neves International Airport | Belo Horizonte | BR |
| CWB | Curitiba-Afonso Pena International Airport | Curitiba | BR |
| EZE | Ezeiza International Airport - Ministro Pistarini | Buenos Aires (Ezeiza) | AR |
| FOR | Pinto Martins International Airport | Fortaleza | BR |
| GIG | Rio de Janeiro Galeão – Tom Jobim International Airport | Rio De Janeiro | BR |
| GRU | São Paulo/Guarulhos–Governor André Franco Montoro International Airport | São Paulo | BR |
| GYE | José Joaquín de Olmedo International Airport | Guayaquil | EC |
| LIM | Jorge Chávez International Airport | Lima | PE |
| MAO | Eduardo Gomes International Airport | Manaus | BR |
| POA | Porto Alegre-Salgado Filho International Airport | Porto Alegre | BR |
| REC | Recife/Guararapes - Gilberto Freyre International Airport | Recife | BR |
| SCL | Comodoro Arturo Merino Benítez International Airport | Santiago | CL |
| SDU | Santos Dumont Airport | Rio de Janeiro | BR |
| SSA | Deputado Luiz Eduardo Magalhães International Airport | Salvador | BR |
| UIO | Mariscal Sucre International Airport | Quito | EC |
| VCP | Viracopos International Airport | Campinas | BR |

### Africa (23)

| IATA | Name | City | Country |
|---|---|---|---|
| ABJ | Félix-Houphouët-Boigny International Airport | Abidjan | CI |
| ABV | Nnamdi Azikiwe International Airport | Abuja | NG |
| ACC | Kotoka International Airport | Accra | GH |
| ADD | Addis Ababa Bole International Airport | Addis Ababa | ET |
| ALG | Houari Boumediene Airport | Algiers | DZ |
| BKO | Modibo Keita International Airport | Bamako | ML |
| CMN | Mohammed V International Airport | Casablanca | MA |
| COO | Cotonou Cadjehoun International Airport | Cotonou | BJ |
| DAR | Julius Nyerere International Airport | Dar es Salaam | TZ |
| DJE | Djerba Zarzis International Airport | Mellita | TN |
| DLA | Douala International Airport | Douala | CM |
| EBB | Entebbe International Airport | Entebbe | UG |
| FIH | Ndjili International Airport | Kinshasa | CD |
| HBE | Alexandria International Airport | Alexandria | EG |
| HRE | Robert Gabriel Mugabe International Airport | Harare | ZW |
| KGL | Kigali International Airport | Kigali | RW |
| KRT | Khartoum International Airport | Khartoum | SD |
| LAD | Quatro de Fevereiro International Airport | Luanda | AO |
| LOS | Murtala Muhammed International Airport | Lagos | NG |
| LUN | Kenneth Kaunda International Airport | Lusaka | ZM |
| ORN | Oran Es-Sénia (Ahmed Ben Bella) International Airport | Es-Sénia | DZ |
| OUA | Ouagadougou Thomas Sankara International Airport | Ouagadougou | BF |
| TUN | Tunis Carthage International Airport | Tunis | TN |

### Oceania (8)

| IATA | Name | City | Country |
|---|---|---|---|
| DRW | Darwin International Airport / RAAF Darwin | Darwin | AU |
| GUM | Antonio B. Won Pat International Airport | Hagåtña | GU |
| HNL | Daniel K. Inouye International Airport | Honolulu, Oahu | US |
| NAN | Nadi International Airport | Nadi | FJ |
| OGG | Kahului International Airport | Kahului | US |
| POM | Port Moresby Jacksons International Airport | Port Moresby | PG |
| PPT | Fa'a'ā International Airport | Papeete | PF |
| VLI | Bauerfield International Airport | Port Vila | VU |
