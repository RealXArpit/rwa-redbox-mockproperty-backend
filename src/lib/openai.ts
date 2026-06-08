import OpenAI from 'openai';

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface ExtractionResult {
  propertyName:  string;
  unitNumber:    string;
  areaSqft:      number | null;
  address:       string;
  propertyType:  string;
  psfPrice:      number | null;
  psfMissing:    boolean;
  description:   string;
  highlights:    string[];
  whyInvest:     string;
}

export const EXTRACTION_SYSTEM_PROMPT = `
You are a property data extraction assistant for RealX Redbox, an Indian real estate investment platform.

Extract structured property data from the provided brochure content.

Return JSON matching this exact schema:
{
  "propertyName":  "string — building/project name",
  "unitNumber":    "string — unit/flat/shop number, or empty string",
  "areaSqft":      number or null,
  "address":       "string — full address including city and PIN if available",
  "propertyType":  "one of exactly: Warehouse | Flat / Apartment | Office Space | Shop / Showroom | Industrial | Other",
  "psfPrice":      number or null — per square foot price in INR. null if not found anywhere,
  "psfMissing":    boolean — true if psfPrice is null,
  "description":   "string — 2-3 sentence investor-facing description",
  "highlights":    ["array of 5-7 short highlight strings, each under 8 words"],
  "whyInvest":     "string — 2-3 sentence investment rationale"
}

Rules:
- psfPrice: look for per sq ft, PSF, rupees per sqft, rate per sqft and variants.
- If psfPrice not found, set to null and psfMissing to true.
- Never invent data not in the brochure.
`.trim();