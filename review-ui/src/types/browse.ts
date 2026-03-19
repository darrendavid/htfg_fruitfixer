export interface BrowsePlant {
  Id: string;
  Canonical_Name: string;
  Botanical_Name: string | null;
  Category: string;
  Aliases: string | null;
  Description: string | null;
  Harvest_Months: string | null;
  At_Kona_Station: boolean;
  Source_Count: number;
  Image_Count: number;
}

export interface BrowseVariety {
  Id: number;
  Variety_Name: string;
  Plant_Id: string;
  Characteristics: string | null;
  Tasting_Notes: string | null;
  Source: string | null;
}

export interface BrowseNutrient {
  Id: number;
  Nutrient_Name: string;
  Plant_Id: string;
  Value: string;
  Unit: string;
  Per_Serving: string;
  Source: string;
}

export interface BrowseDocument {
  Id: number;
  Title: string;
  Doc_Type: string;
  Content_Preview: string | null;
  Content_Text: string | null;
  Plant_Ids: string | null;
  Original_File_Path: string;
}

export interface BrowseRecipe {
  Id: number;
  Title: string;
  Ingredients: string | null;
  Method: string | null;
  Plant_Ids: string | null;
  Source_File: string;
}

export interface BrowseOcr {
  Id: number;
  Title: string;
  Image_Path: string;
  Content_Type: string;
  Extracted_Text: string | null;
  Key_Facts: string | null;
  Plant_Ids: string | null;
  Source_Context: string | null;
}

export interface BrowseAttachment {
  Id: number;
  Title: string;
  File_Path: string;
  File_Name: string;
  File_Type: string;
  File_Size: number;
  Plant_Ids: string | null;
  Description: string | null;
}

export interface BrowseImage {
  Id: number;
  File_Path: string;
  Plant_Id: string | null;
  Caption: string | null;
  Source_Directory: string | null;
  Size_Bytes: number;
}

export interface StaffNote {
  id: number;
  plant_id: string;
  variety_id: number | null;
  user_id: number;
  user_name: string;
  text: string;
  created_at: string;
  updated_at: string;
}

export interface PlantDetail {
  plant: BrowsePlant;
  varieties: BrowseVariety[];
  nutritional: BrowseNutrient[];
  images: { list: BrowseImage[]; pageInfo: { totalRows: number; page: number; pageSize: number } };
  documents: BrowseDocument[];
  attachments: BrowseAttachment[];
  recipes: BrowseRecipe[];
  ocr: BrowseOcr[];
  notes: StaffNote[];
}
