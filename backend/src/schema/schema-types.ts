/**
 * Curated allow-list of schema.org @types relevant to web/SEO structured data.
 *
 * Phase 1 validates *schema.org structural validity only* (per product decision):
 * a node's @type must be a recognised schema.org type. We don't ship Google's
 * full rich-result eligibility rules here — this list keeps validation
 * deterministic and free (no external API; there is no official Google
 * validation API). Unknown types are surfaced as a warning, not a hard error,
 * so genuinely valid-but-rare types don't get flagged as broken.
 */

export const SCHEMA_ORG_TYPES: ReadonlySet<string> = new Set([
  // Core / creative works
  'Thing',
  'CreativeWork',
  'WebSite',
  'WebPage',
  'WebPageElement',
  'AboutPage',
  'ContactPage',
  'CollectionPage',
  'ItemPage',
  'ProfilePage',
  'SearchResultsPage',
  'CheckoutPage',
  'FAQPage',
  'QAPage',
  'Article',
  'NewsArticle',
  'BlogPosting',
  'Blog',
  'TechArticle',
  'Report',
  'ScholarlyArticle',
  'WebContent',
  'Comment',
  'CreativeWorkSeries',

  // Navigation / structure
  'BreadcrumbList',
  'ListItem',
  'ItemList',
  'SiteNavigationElement',
  'WPHeader',
  'WPFooter',
  'WPSideBar',

  // Organisations / people / places
  'Organization',
  'Corporation',
  'NGO',
  'EducationalOrganization',
  'GovernmentOrganization',
  'LocalBusiness',
  'ProfessionalService',
  'Store',
  'Restaurant',
  'Hotel',
  'LodgingBusiness',
  'MedicalBusiness',
  'Dentist',
  'Physician',
  'LegalService',
  'Attorney',
  'FinancialService',
  'AccountingService',
  'HomeAndConstructionBusiness',
  'GeneralContractor',
  'Plumber',
  'Electrician',
  'RoofingContractor',
  'HVACBusiness',
  'AutoRepair',
  'BeautySalon',
  'HairSalon',
  'HealthAndBeautyBusiness',
  'EmergencyService',
  'FoodEstablishment',
  'RealEstateAgent',
  'TravelAgency',
  'Person',
  'Place',
  'PostalAddress',
  'GeoCoordinates',
  'GeoShape',
  'OpeningHoursSpecification',
  'ContactPoint',
  'Country',
  'AdministrativeArea',
  'City',

  // Products / commerce
  'Product',
  'ProductGroup',
  'ProductModel',
  'IndividualProduct',
  'SomeProducts',
  'Offer',
  'AggregateOffer',
  'OfferShippingDetails',
  'ShippingDeliveryTime',
  'MerchantReturnPolicy',
  'PriceSpecification',
  'UnitPriceSpecification',
  'Brand',
  'Service',
  'ServiceChannel',
  'Demand',

  // Reviews / ratings
  'Review',
  'Rating',
  'AggregateRating',
  'EndorsementRating',

  // Media
  'ImageObject',
  'VideoObject',
  'AudioObject',
  'MediaObject',
  'MusicRecording',
  'Photograph',

  // Events / how-to / recipes / Q&A
  'Event',
  'BusinessEvent',
  'EducationEvent',
  'Festival',
  'HowTo',
  'HowToStep',
  'HowToSection',
  'HowToSupply',
  'HowToTool',
  'Recipe',
  'NutritionInformation',
  'Question',
  'Answer',

  // Jobs / education / software
  'JobPosting',
  'Course',
  'CourseInstance',
  'EducationalOccupationalProgram',
  'SoftwareApplication',
  'WebApplication',
  'MobileApplication',

  // Misc commonly emitted
  'SearchAction',
  'EntryPoint',
  'PropertyValue',
  'Quantity',
  'Duration',
  'MonetaryAmount',
  'DefinedTerm',
  'Language',
]);

/** True when `type` is a recognised schema.org type from our curated set. */
export function isKnownSchemaType(type: string): boolean {
  return SCHEMA_ORG_TYPES.has(type);
}
