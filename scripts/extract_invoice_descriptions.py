
import os
import sys
import logging
import re
import pandas as pd
from collections import Counter

# Add project root to path to allow importing backend modules
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.append(project_root)
# Add backend directory to path as well for internal imports (e.g. from config import ...)
sys.path.append(os.path.join(project_root, 'backend'))

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

try:
    from backend.database import get_database_client
except ImportError as e:
    logger.error(f"Failed to import backend modules: {e}")
    logger.error("Make sure you are running this script correctly and credentials are set up.")
    sys.exit(1)

def normalize_description(text):
    """
    Normalize description text for grouping.
    - Lowercase
    - Remove non-alphanumeric characters
    - Sort words to handle 'filter oil' vs 'oil filter'
    """
    if not text or not isinstance(text, str):
        return ""
    
    # Lowercase and remove punctuation
    clean_text = re.sub(r'[^a-z0-9\s]', ' ', text.lower())
    
    # Split, sort, and join to handle word order variations if desired
    # For now, let's keep word order as meaningful but collapse spaces
    # words = clean_text.split()
    # return " ".join(sorted(words)) 
    
    # Actually, for "verified invoices" and "similar values", exact word order usually matters 
    # (e.g. "front bumper" vs "bumper front"). 
    # But user said "similar values... aggregated".
    # I'll stick to a simpler normalization: strip extra spaces.
    return " ".join(clean_text.split())

def main():
    logger.info("Starting description extraction...")
    
    try:
        db = get_database_client()
        
        # specific column selection? or all?
        # Let's get description and username, maybe count?
        # We need raw data first.
        
        logger.info("Fetching verified invoices from Supabase...")
        query = db.client.table('verified_invoices').select('description, username, row_id').execute()
        records = query.data
        
        if not records:
            logger.warning("No verified invoices found.")
            return

        logger.info(f"Found {len(records)} records.")
        
        # Process records
        processed_data = []
        
        # Grouping tracker
        # key: normalized_desc
        # value: {count: int, originals: set(), examples: list()}
        groups = {}
        
        for record in records:
            original_desc = record.get('description')
            if not original_desc:
                continue
                
            norm_desc = normalize_description(original_desc)
            
            if norm_desc not in groups:
                groups[norm_desc] = {
                    'count': 0,
                    'originals': set(),
                    'example': original_desc
                }
            
            groups[norm_desc]['count'] += 1
            groups[norm_desc]['originals'].add(original_desc)
            
        # Convert to DataFrame
        output_rows = []
        for norm, data in groups.items():
            output_rows.append({
                'Normalized Description': norm,
                'Count': data['count'],
                'Original Variations': ", ".join(sorted(list(data['originals']))),
                'Example User Input': data['example']
            })
            
        df = pd.DataFrame(output_rows)
        
        # Sort by Count descending
        df = df.sort_values('Count', ascending=False)
        
        # Output file
        output_file = os.path.join(project_root, 'invoice_descriptions_grouped.xlsx')
        
        logger.info(f"Saving to {output_file}...")
        df.to_excel(output_file, index=False)
        
        logger.info("Done!")
        print(f"Successfully created: {output_file}")
        
    except Exception as e:
        logger.error(f"An error occurred: {e}", exc_info=True)

if __name__ == "__main__":
    main()
