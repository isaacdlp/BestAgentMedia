import type { PrismaClient } from "@prisma/client";

// HERE Places category system (https://docs.here.com/geocoding-and-search/docs/places-category-system-full).
// Entries are "<HERE category ID>|<name>".
const hereCategoryData = `
100-1000-0000|Restaurant
100-1000-0001|Casual Dining
100-1000-0002|Fine Dining
100-1000-0003|Take Out and Delivery Only
100-1000-0004|Food Market-Stall
100-1000-0005|Taqueria
100-1000-0006|Deli
100-1000-0007|Cafeteria
100-1000-0008|Bistro
100-1000-0009|Fast Food
100-1000-0050|Family Restaurant
100-1100-0000|Coffee-Tea
100-1100-0010|Coffee Shop
100-1100-0331|Tea House
200-2000-0000|Nightlife-Entertainment
200-2000-0011|Bar or Pub
200-2000-0012|Night Club
200-2000-0013|Dancing
200-2000-0014|Karaoke
200-2000-0015|Live Entertainment-Music
200-2000-0016|Billiards-Pool Hall
200-2000-0017|Video Arcade-Game Room
200-2000-0018|Jazz Club
200-2000-0019|Beer Garden
200-2000-0306|Adult Entertainment
200-2000-0368|Cocktail Lounge
200-2100-0019|Cinema
200-2200-0000|Theatre, Music and Culture
200-2200-0020|Performing Arts
200-2300-0000|Gambling-Lottery-Betting
200-2300-0021|Casino
200-2300-0022|Lottery Booth
300-3000-0000|Landmark-Attraction
300-3000-0023|Tourist Attraction
300-3000-0024|Gallery
300-3000-0025|Historical Monument
300-3000-0030|Castle
300-3000-0065|Winery
300-3000-0350|Brewery
300-3000-0351|Distillery
300-3000-0450|Hot Spring
300-3100-0000|Museum
300-3100-0026|Science Museum
300-3100-0027|Children's Museum
300-3100-0028|History Museum
300-3100-0029|Art Museum
300-3200-0000|Religious Place
300-3200-0030|Church
300-3200-0031|Temple
300-3200-0032|Synagogue
300-3200-0033|Ashram
300-3200-0034|Mosque
300-3200-0035|Shrine
300-3200-0309|Other Place of Worship
300-3200-0375|Gurdwara
300-3200-0376|Pagoda
350-3500-0233|Body of Water
350-3500-0234|Reservoir
350-3500-0235|Waterfall
350-3500-0300|Bay-Harbor
350-3500-0302|River
350-3500-0303|Canal
350-3500-0304|Lake
350-3510-0236|Mountain or Hill
350-3510-0237|Mountain Passes
350-3510-0238|Mountain Peaks
350-3520-0224|Undersea Feature
350-3522-0239|Forest, Heath or Other Vegetation
350-3550-0336|Natural and Geographical
400-4000-4580|Public Sports Airport
400-4000-4581|Airport
400-4000-4582|Airport Terminal
400-4100-0035|Train Station
400-4100-0036|Bus Station
400-4100-0037|Underground Train-Subway
400-4100-0038|Commuter Rail Station
400-4100-0039|Commuter Train
400-4100-0040|Public Transit Access
400-4100-0041|Transportation Service
400-4100-0042|Bus Stop
400-4100-0043|Local Transit
400-4100-0044|Ferry Terminal
400-4100-0045|Boat Ferry
400-4100-0046|Rail Ferry
400-4100-0047|Taxi Stand
400-4100-0051|Rideshare Pickup
400-4100-0225|Highway Entrance
400-4100-0226|Highway Exit
400-4100-0326|Tollbooth
400-4100-0337|Lightrail
400-4100-0338|Water Transit
400-4100-0339|Monorail
400-4100-0340|Aerial Tramway
400-4100-0341|Bus Rapid Transit
400-4100-0342|Inclined Rail
400-4100-0347|Bicycle Sharing Location
400-4100-0348|Bicycle Parking
400-4200-0048|Weigh Station
400-4200-0049|Cargo Center
400-4200-0050|Rail Yard
400-4200-0051|Seaport-Harbour
400-4200-0052|Airport Cargo
400-4200-0240|Couriers
400-4200-0241|Cargo Transportation
400-4200-0311|Delivery Entrance
400-4200-0312|Loading Dock
400-4200-0313|Loading Zone
400-4300-0000|Rest Area
400-4300-0199|Complete Rest Area
400-4300-0200|Parking and Restroom Only Rest Area
400-4300-0201|Parking Only Rest Area
400-4300-0202|Motorway Service Rest Area
400-4300-0251|Roadside Station
400-4300-0308|Scenic Overlook Rest Area
500-5000-0000|Hotel or Motel
500-5000-0053|Hotel
500-5000-0054|Motel
500-5100-0000|Lodging
500-5100-0055|Hostel
500-5100-0056|Campground
500-5100-0057|Guest House
500-5100-0058|Bed and Breakfast
500-5100-0059|Holiday Park
500-5100-0060|Short-Time Motel
500-5100-0061|Ryokan
550-5510-0000|Outdoor-Recreation
550-5510-0202|Park-Recreation Area
550-5510-0203|Sports Field
550-5510-0204|Garden
550-5510-0205|Beach
550-5510-0206|Recreation Center
550-5510-0227|Ski Lift
550-5510-0242|Scenic Point
550-5510-0358|Off Road Trailhead
550-5510-0359|Trailhead
550-5510-0374|Off-Road Vehicle Area
550-5510-0378|Campsite
550-5510-0379|Outdoor Service
550-5510-0380|Ranger Station
550-5510-0387|Bicycle Service
550-5520-0000|Leisure
550-5520-0207|Amusement Park
550-5520-0208|Zoo
550-5520-0209|Wild Animal Park
550-5520-0210|Wildlife Refuge
550-5520-0211|Aquarium
550-5520-0212|Ski Resort
550-5520-0228|Animal Park
550-5520-0357|Water Park
600-6000-0061|Convenience Store
600-6100-0062|Shopping Mall
600-6200-0063|Department Store
600-6300-0064|Food-Beverage Specialty Store
600-6300-0066|Grocery
600-6300-0067|Specialty Food Store
600-6300-0068|Wine and Liquor
600-6300-0244|Bakery and Baked Goods Store
600-6300-0245|Sweet Shop
600-6300-0246|Doughnut Shop
600-6300-0363|Butcher
600-6300-0364|Dairy Goods
600-6400-0000|Drugstore or Pharmacy
600-6400-0069|Drugstore
600-6400-0070|Pharmacy
600-6500-0072|Consumer Electronics Store
600-6500-0073|Mobile Retailer
600-6500-0074|Mobile Service Center
600-6500-0075|Computer and Software
600-6500-0076|Entertainment Electronics
600-6600-0000|Hardware, House and Garden
600-6600-0077|Home Improvement
600-6600-0078|Home Specialty Store
600-6600-0079|Floor and Carpet
600-6600-0080|Furniture Store
600-6600-0082|Garden Center
600-6600-0083|Glass and Window
600-6600-0084|Lumber
600-6600-0085|Major Appliance
600-6600-0310|Power Equipment Dealer
600-6600-0319|Paint Store
600-6700-0000|Other Bookshop
600-6700-0087|Bookstore
600-6800-0000|Clothing and Accessories
600-6800-0089|Men's Apparel
600-6800-0090|Women's Apparel
600-6800-0091|Children's Apparel
600-6800-0092|Shoes-Footwear
600-6800-0093|Specialty Clothing Store
600-6900-0000|Consumer Goods
600-6900-0094|Sporting Goods Store
600-6900-0095|Office Supply and Services Store
600-6900-0096|Specialty Store
600-6900-0097|Pet Supply
600-6900-0098|Wholesale Store
600-6900-0099|General Merchandise
600-6900-0100|Discount Store
600-6900-0101|Flowers and Jewelry
600-6900-0102|Variety Store
600-6900-0103|Gift, Antique and Art
600-6900-0105|Record, CD and Video
600-6900-0106|Video and Game Rental
600-6900-0107|Cigar and Tobacco Shop
600-6900-0108|Vaping Store
600-6900-0246|Bicycle and Bicycle Accessories Shop
600-6900-0247|Market
600-6900-0248|Motorcycle Accessories
600-6900-0249|Non-Store Retailers
600-6900-0250|Pawnshop
600-6900-0251|Used-Second Hand Merchandise Stores
600-6900-0305|Adult Shop
600-6900-0307|Arts and Crafts Supplies
600-6900-0355|Florist
600-6900-0356|Jeweler
600-6900-0358|Toy Store
600-6900-0387|Golf Shop
600-6900-0388|Hunting-Fishing Shop
600-6900-0389|Running-Walking Shop
600-6900-0390|Skate Shop
600-6900-0391|Ski Shop
600-6900-0392|Snowboard Shop
600-6900-0393|Surf Shop
600-6900-0394|BMX Shop
600-6900-0395|Camping-Hiking Shop
600-6900-0396|Canoe-Kayak Shop
600-6900-0397|Cross Country Ski Shop
600-6900-0398|Tack Shop
600-6950-0000|Hair and Beauty
600-6950-0399|Barber
600-6950-0400|Nail Salon
600-6950-0401|Hair Salon
700-7000-0107|Bank
700-7010-0108|ATM
700-7050-0109|Money Transferring Service
700-7050-0110|Check Cashing Service-Currency Exchange
700-7100-0000|Communication-Media
700-7100-0134|Telephone Service
700-7200-0000|Commercial Services
700-7200-0252|Advertising-Marketing, PR and Market Research
700-7200-0253|Catering and Other Food Services
700-7200-0254|Construction
700-7200-0255|Customer Care-Service Center
700-7200-0256|Engineering and Scientific Services
700-7200-0257|Farming
700-7200-0258|Food Production
700-7200-0259|Human Resources and Recruiting Services
700-7200-0260|Investigation Services
700-7200-0261|IT and Office Equipment Services
700-7200-0262|Landscaping Services
700-7200-0263|Locksmiths and Security Systems Services
700-7200-0264|Management and Consulting Services
700-7200-0265|Manufacturing
700-7200-0266|Mining, Quarrying and Other Extraction
700-7200-0267|Modeling Agencies
700-7200-0268|Motorcycle Service and Maintenance
700-7200-0269|Organizations and Societies
700-7200-0270|Entertainment and Recreation
700-7200-0271|Finance and Insurance
700-7200-0272|Healthcare and Healthcare Support Services
700-7200-0274|Rental and Leasing
700-7200-0275|Repair and Maintenance Services
700-7200-0276|Printing and Publishing
700-7200-0277|Specialty Trade Contractors
700-7200-0278|Towing Service
700-7200-0279|Translation and Interpretation Services
700-7200-0324|Apartment Rental-Flat Rental
700-7200-0328|B2B Sales and Services
700-7200-0329|B2B Restaurant Services
700-7200-0330|Aviation
700-7200-0342|Interior and Exterior Design
700-7200-0344|Property Management
700-7200-0345|Financial Investment Firm
700-7200-0351|Warehouse
700-7200-0352|Fulfillment and Distribution Center
700-7250-0136|Business Facility
700-7300-0110|Police Box
700-7300-0111|Police Station
700-7300-0112|Police Services-Security
700-7300-0113|Fire Department
700-7300-0280|Ambulance Services
700-7400-0000|Consumer Services
700-7400-0133|Travel Agent-Ticketing
700-7400-0137|Dry Cleaning and Laundry
700-7400-0138|Attorney
700-7400-0140|Boating
700-7400-0141|Business Service
700-7400-0142|Funeral Director
700-7400-0143|Mover
700-7400-0144|Photography
700-7400-0145|Real Estate Services
700-7400-0146|Repair Service
700-7400-0147|Social Service
700-7400-0148|Storage
700-7400-0149|Tailor and Alteration
700-7400-0150|Tax Service
700-7400-0151|Utilities
700-7400-0152|Waste and Sanitary
700-7400-0281|Bicycle Service and Maintenance
700-7400-0282|Bill Payment Service
700-7400-0283|Body Piercing and Tattoos
700-7400-0284|Wedding Services and Bridal Studio
700-7400-0285|Internet Cafe
700-7400-0286|Kindergarten and Childcare
700-7400-0287|Maid Services
700-7400-0288|Marriage and Match Making Services
700-7400-0289|Public Administration
700-7400-0292|Wellness Center and Services
700-7400-0293|Pet Care
700-7400-0327|Legal Services
700-7400-0343|Tanning Salon
700-7400-0352|Recycling Center
700-7400-0365|Electrical
700-7400-0366|Plumbing
700-7450-0114|Post Office
700-7450-0115|Postal Collection Box
700-7460-0115|Tourist Information
700-7600-0000|Fueling Station
700-7600-0116|Petrol-Gasoline Station
700-7600-0322|EV Charging Station for passenger cars
700-7600-0323|EV Charging Station for Trucks
700-7600-0324|EV Charging Station for 2-wheelers and Light Vehicles
700-7600-0325|EV Battery Swap Station
700-7600-0444|Hydrogen Fuel Station
700-7800-0118|Automobile Dealership-New Cars
700-7800-0119|Automobile Dealership-Used Cars
700-7800-0120|Motorcycle Dealership
700-7800-0200|EV Dealership-New Vehicles
700-7850-0000|Car Repair-Service
700-7850-0121|Car Wash-Detailing
700-7850-0122|Car Repair
700-7850-0123|Auto Parts
700-7850-0124|Emission Testing
700-7850-0125|Tire Repair
700-7850-0126|Truck Repair
700-7850-0127|Van Repair
700-7850-0128|Road Assistance
700-7850-0129|Automobile Club
700-7850-0200|EV Repair
700-7851-0117|Rental Car Agency
700-7851-0127|Carshare Location
700-7900-0000|Truck-Semi Dealer-Services
700-7900-0130|Truck Dealership
700-7900-0131|Truck Parking
700-7900-0132|Truck Stop-Plaza
700-7900-0323|Truck Wash
800-8000-0000|Hospital or Health Care Facility
800-8000-0154|Dentist-Dental Office
800-8000-0155|Family-General Practice Physicians
800-8000-0156|Psychiatric Institute
800-8000-0157|Nursing Home
800-8000-0158|Medical Services-Clinics
800-8000-0159|Hospital
800-8000-0160|Urgent Care Center
800-8000-0161|Optical
800-8000-0162|Veterinarian
800-8000-0325|Hospital Emergency Room
800-8000-0340|Therapist
800-8000-0341|Chiropractor
800-8000-0367|Blood Bank
800-8000-0400|COVID-19 Testing Site
800-8000-0401|Vaccination Site
800-8100-0000|Government or Community Facility
800-8100-0163|City Hall
800-8100-0164|Embassy
800-8100-0165|Military Base
800-8100-0168|County Council
800-8100-0169|Civic-Community Center
800-8100-0170|Courthouse
800-8100-0171|Government Office
800-8100-0172|Border Crossing
800-8200-0000|Education Facility
800-8200-0173|Higher Education
800-8200-0295|Training and Development
800-8200-0360|Coaching Institute
800-8200-0361|Fine Arts
800-8200-0362|Language Studies
800-8250-0000|School
800-8250-0287|Primary School
800-8250-0288|Secondary School
800-8300-0000|Other Library
800-8300-0175|Library
800-8400-0000|Event Spaces
800-8400-0139|Banquet Hall
800-8400-0176|Convention-Exhibition Center
800-8500-0000|Parking
800-8500-0177|Parking Garage-Parking House
800-8500-0178|Parking Lot
800-8500-0179|Park and Ride
800-8500-0200|Motorcycle, Moped and Scooter Parking
800-8500-0315|Cellphone Parking Lot
800-8600-0000|Sports Facility-Venue
800-8600-0180|Sports Complex-Stadium
800-8600-0181|Ice Skating Rink
800-8600-0182|Swimming Pool
800-8600-0183|Tennis Court
800-8600-0184|Bowling Center
800-8600-0185|Indoor Ski
800-8600-0186|Hockey
800-8600-0187|Racquetball Court
800-8600-0188|Shooting Range
800-8600-0189|Soccer Club
800-8600-0190|Squash Court
800-8600-0191|Fitness-Health Club
800-8600-0192|Indoor Sports
800-8600-0193|Golf Course
800-8600-0194|Golf Practice Range
800-8600-0195|Race Track
800-8600-0196|Sporting Instruction and Camps
800-8600-0197|Sports Activities
800-8600-0199|Basketball
800-8600-0200|Badminton
800-8600-0314|Rugby
800-8600-0316|Diving Center
800-8600-0376|Bike Park
800-8600-0377|BMX Track
800-8600-0381|Running Track
800-8700-0000|Facilities
800-8700-0166|Cemetery
800-8700-0167|Crematorium
800-8700-0198|Public Restroom-Toilets
800-8700-0296|Clubhouse
800-8700-0298|Registration Office
800-8700-0333|Student Housing
900-9100-0000|City, Town or Village
900-9200-0000|Outdoor Area-Complex
900-9200-0218|Industrial Zone
900-9200-0219|Marina
900-9200-0220|RV Parks
900-9200-0299|Collective Community
900-9200-0301|Island
900-9200-0386|Meeting Point
900-9300-0000|Building
900-9300-0221|Residential Area-Building
900-9400-0000|Administrative Region-Streets
900-9400-0399|Administrative Region
900-9400-0400|Postal Area
900-9400-0401|Street or Square
900-9400-0402|Intersection
`;

const hereCategories = hereCategoryData
  .trim()
  .split("\n")
  .map((line) => {
    const [hereId, name] = line.split("|");
    return { hereId: hereId.trim(), name: name.trim() };
  });

export async function seedHereCategories(prisma: PrismaClient) {
  const uniqueCategories = [
    ...new Map(hereCategories.map((category) => [category.hereId, category])).values(),
  ];
  for (const category of uniqueCategories) {
    await prisma.hereCategory.upsert({
      where: { hereId: category.hereId },
      update: { name: category.name },
      create: category,
    });
  }
  console.info(`Seeded ${uniqueCategories.length} HERE categories.`);
}
