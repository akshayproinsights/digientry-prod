"""
Verification workflow service.
Contains build_verified() and run_sync_verified_logic() ported from old processor.
"""
import pandas as pd
import logging
from typing import Dict, Any, Optional
from datetime import datetime

from utils.date_helpers import normalize_date, format_to_mmm, safe_format_date_series
# Note: sheets imports removed - now using Supabase via run_sync_verified_logic_supabase()
# Old run_sync_verified_logic() kept for reference but not actively used

logger = logging.getLogger(__name__)


def _find_col(df: pd.DataFrame, candidates: list) -> Optional[str]:
    """Find a column in the dataframe using case-insensitive matching"""
    for c in candidates:
        if c in df.columns:
            return c
    for c in df.columns:
        if c.lower().replace(" ", "").replace("-", "_") in [x.lower().replace(" ", "").replace("-", "_") for x in candidates]:
            return c
    return None


def build_verified(df_raw: pd.DataFrame, df_date: pd.DataFrame, df_amount: pd.DataFrame) -> pd.DataFrame:
    """
    Build the Invoice Verified sheet from Invoice All and verification sheets.
    This is the core verification logic that:
    1. Excludes pending records
    2. Includes verified records
    3. Applies corrections from verification sheets
    """
    raw = df_raw.copy()
    date = df_date.copy()
    amount = df_amount.copy()

    rowid_col_raw = _find_col(raw, ["row_id", "Row_Id", "Row ID", "rowid"])
    rowid_col_date = _find_col(date, ["row_id", "Row_Id", "Row ID", "rowid"])
    rowid_col_amount = _find_col(amount, ["row_id", "Row_Id", "Row ID", "rowid"])

    def clean_link(x):
        if pd.isna(x):
            return pd.NA
        s = str(x).strip()
        return s if s else pd.NA

    def as_str_trim(x):
        if pd.isna(x):
            return ""
        s = str(x).strip()
        if s.endswith('.0'):
            s = s[:-2]
        return s

    def fix_date(series):
        """Parse dates using explicit dd-mm-yyyy or dd-MMM-yyyy format"""
        def parse_single_date(val):
            if pd.isna(val) or not val:
                return pd.NaT
            
            s = str(val).strip()
            if not s:
                return pd.NaT
            
            for fmt in ["%d-%b-%Y", "%d-%m-%Y", "%d/%m/%Y"]:
                try:
                    return datetime.strptime(s, fmt)
                except:
                    continue
            
            normalized = normalize_date(s)
            if normalized:
                try:
                    return datetime.strptime(normalized, "%d-%m-%Y")
                except:
                    pass
            
            return pd.NaT
        
        dt = series.apply(parse_single_date)
        result = dt.apply(lambda x: x.strftime("%d-%b-%Y") if pd.notna(x) else "")
        return result

    # Clean and prepare data
    raw["Receipt Link_clean"] = raw.get("Receipt Link", pd.Series([pd.NA]*len(raw))).apply(clean_link)
    raw["Receipt Number_str"] = raw.get("Receipt Number", pd.Series([""]*len(raw))).astype(str).fillna("").apply(as_str_trim)
    raw["Date"] = fix_date(raw.get("Date", pd.Series([pd.NA]*len(raw))))

    date["Receipt Link_clean"] = date.get("Receipt Link", pd.Series([pd.NA]*len(date))).apply(clean_link)
    date["Receipt Number_str"] = date.get("Receipt Number", pd.Series([""]*len(date))).astype(str).fillna("").apply(as_str_trim)
    date["Verification Status_clean"] = date.get("Verification Status", pd.Series([""]*len(date))).astype(str).str.strip().str.lower()
    
    # DEBUG: Log verification status values
    if not date.empty:
        status_counts = date["Verification Status_clean"].value_counts()
        logger.info(f"🔍 Date verification statuses: {status_counts.to_dict()}")
    
    amount["Receipt Link_clean"] = amount.get("Receipt Link", pd.Series([pd.NA]*len(amount))).apply(clean_link)
    amount["Receipt Number_str"] = amount.get("Receipt Number", pd.Series([""]*len(amount))).astype(str).fillna("").apply(as_str_trim)
    amount["Verification Status_clean"] = amount.get("Verification Status", pd.Series([""]*len(amount))).astype(str).str.strip().str.lower()
    
    # DEBUG: Log verification status values 
    if not amount.empty:
        status_counts = amount["Verification Status_clean"].value_counts()
        logger.info(f"🔍 Amount verification statuses: {status_counts.to_dict()}")
    date["Date"] = fix_date(date.get("Date", pd.Series([pd.NA]*len(date))))
    
    if "Upload Date" in date.columns:
        date["Upload Date_dt"] = pd.to_datetime(date["Upload Date"], errors="coerce")
        date = date.sort_values("Upload Date_dt").drop_duplicates(subset=["Receipt Link_clean", "Receipt Number_str"], keep="last")
    else:
        date = date.drop_duplicates(subset=["Receipt Link_clean", "Receipt Number_str"], keep="last")

    amount["Receipt Link_clean"] = amount.get("Receipt Link", pd.Series([pd.NA]*len(amount))).apply(clean_link)
    amount["Receipt Number_str"] = amount.get("Receipt Number", pd.Series([""]*len(amount))).astype(str).fillna("").apply(as_str_trim)
    amount["Verification Status_clean"] = amount.get("Verification Status", pd.Series([""]*len(amount))).astype(str).str.strip().str.lower()
    
    if "Upload Date" in amount.columns:
        amount["Upload Date_dt"] = pd.to_datetime(amount["Upload Date"], errors="coerce")
        amount = amount.sort_values("Upload Date_dt").drop_duplicates(
            subset=["Receipt Number_str", "Description", rowid_col_amount] if rowid_col_amount else ["Receipt Number_str", "Description"], 
            keep="last"
        )
    else:
        amount = amount.drop_duplicates(
            subset=["Receipt Number_str", "Description", rowid_col_amount] if rowid_col_amount else ["Receipt Number_str", "Description"], 
            keep="last"
        )

    # Identify pending records to exclude
    date_pending_row_ids = set()
    date_pending_receipts = set()  # NEW: Track Receipt Numbers that are Pending in Dates
    if rowid_col_date and rowid_col_date in date.columns:
        date_pending_row_ids = set(date.loc[date["Verification Status_clean"] != "done", rowid_col_date].dropna().astype(str))
        # Get Receipt Numbers that are Pending/Duplicate in Dates
        date_pending_receipts = set(date.loc[date["Verification Status_clean"].isin(["pending", "duplicate receipt number"]), "Receipt Number_str"].dropna())
    
    amount_pending_row_ids = set()
    amount_pending_receipts = set()  # NEW: Track Receipt Numbers that are Pending in Amount
    if rowid_col_amount and rowid_col_amount in amount.columns:
        amount_pending_row_ids = set(amount.loc[amount["Verification Status_clean"] != "done", rowid_col_amount].dropna().astype(str))
        # Get Receipt Numbers that are Pending/Duplicate in Amount
        amount_pending_receipts = set(amount.loc[amount["Verification Status_clean"].isin(["pending", "duplicate receipt number"]), "Receipt Number_str"].dropna())

    # Identify done records
    date_done_links = set(date.loc[date["Verification Status_clean"] == "done", "Receipt Link_clean"].dropna())
    date_done_numbers = set(date.loc[date["Verification Status_clean"] == "done", "Receipt Number_str"].dropna())
    amount_done_numbers = set(amount.loc[amount["Verification Status_clean"] == "done", "Receipt Number_str"].dropna())
    amount_done_rowids = set()
    if rowid_col_amount and rowid_col_amount in amount.columns:
        amount_done_rowids = set(amount.loc[amount["Verification Status_clean"] == "done", rowid_col_amount].dropna().astype(str))

    # All verification sheet records
    date_links_all = set(date["Receipt Link_clean"].dropna())
    date_numbers_all = set(date["Receipt Number_str"].dropna())
    amount_numbers_all = set(amount["Receipt Number_str"].dropna())
    amount_links_all = set(amount["Receipt Link_clean"].dropna())
    amount_rowids_all = set()
    if rowid_col_amount and rowid_col_amount in amount.columns:
        amount_rowids_all = set(amount[rowid_col_amount].dropna().astype(str))

    # Combine pending Row_Ids for exclusion
    excluded_row_ids = date_pending_row_ids | amount_pending_row_ids
    
    # NEW: Combine pending Receipt Numbers - these should NEVER go to Verified
    # If a Receipt Number is Pending in either Dates or Amount, exclude it entirely
    pending_receipts_all = date_pending_receipts | amount_pending_receipts
    
    # Also exclude rejected records
    if 'Review Status' in raw.columns and rowid_col_raw:
        rejected_mask = raw['Review Status'].astype(str).str.lower() == 'rejected'
        rejected_row_ids = set(raw.loc[rejected_mask, rowid_col_raw].dropna().astype(str))
        excluded_row_ids = excluded_row_ids | rejected_row_ids

    # Distinguish "Verified" from "Already Verified"
    already_verified_mask = pd.Series([False] * len(raw), index=raw.index)
    if 'Review Status' in raw.columns:
        status_lower = raw['Review Status'].astype(str).str.lower()
        already_verified_mask = status_lower == 'verified'

    presence_mask_any_verify = (
        raw["Receipt Link_clean"].isin(date_links_all) |
        raw["Receipt Link_clean"].isin(amount_links_all) |
        raw["Receipt Number_str"].isin(date_numbers_all) |
        raw["Receipt Number_str"].isin(amount_numbers_all) |
        raw.get(rowid_col_raw, pd.Series([pd.NA]*len(raw))).astype(str).isin(amount_rowids_all)
    )

    # Base dataframe: records NOT in verification or already verified
    base_df = raw[(~presence_mask_any_verify) | already_verified_mask].copy()
    logger.info(f"📊 Base dataframe (not in verification OR already verified): {len(base_df)} records")
    
    if excluded_row_ids and rowid_col_raw:
        before_exclude = len(base_df)
        base_df = base_df[~base_df.get(rowid_col_raw, pd.Series([""] * len(base_df))).astype(str).isin(excluded_row_ids)].copy()
        logger.info(f"📊 After excluding pending row_ids: {len(base_df)} records (removed {before_exclude - len(base_df)})")
    
    # NEW: Exclude any records with Receipt Numbers that are Pending in ANY sheet
    if pending_receipts_all:
        before_exclude = len(base_df)
        # Use the actual column name as it appears in base_df
        receipt_col = 'Receipt Number' if 'Receipt Number' in base_df.columns else 'receipt_number'
        base_df = base_df[~base_df[receipt_col].astype(str).isin(pending_receipts_all)].copy()
        logger.info(f"📊 After excluding pending receipts: {len(base_df)} records (removed {before_exclude - len(base_df)})")
    
    # Exclude rejected and already verified
    if 'Review Status' in base_df.columns:
        before_exclude = len(base_df)
        status_lower = base_df['Review Status'].astype(str).str.lower()
        base_df = base_df[~status_lower.isin(['rejected', 'already verified'])].copy()
        logger.info(f"📊 After excluding rejected/already verified: {len(base_df)} records (removed {before_exclude - len(base_df)})")
    
    base_df["Review Status"] = "Verified"

    # Process done records
    mask_candidate_date_done = raw["Receipt Link_clean"].isin(date_done_links)
    mask_candidate_amount_done_rowid = False
    if rowid_col_raw:
        mask_candidate_amount_done_rowid = raw.get(rowid_col_raw, pd.Series([""]*len(raw))).astype(str).isin(amount_done_rowids)
    mask_candidate_amount_done_number = raw["Receipt Number_str"].isin(amount_done_numbers)

    mask_blocked_by_pending_rowid = False
    if rowid_col_raw and excluded_row_ids:
        mask_blocked_by_pending_rowid = raw.get(rowid_col_raw, pd.Series([""] * len(raw))).astype(str).isin(excluded_row_ids)
    
    # NEW: Also block if Receipt Number is Pending in ANY sheet
    mask_blocked_by_pending_receipt = False
    if pending_receipts_all:
        mask_blocked_by_pending_receipt = raw["Receipt Number_str"].isin(pending_receipts_all)

    inclusion_mask = (
        (mask_candidate_date_done | mask_candidate_amount_done_rowid | mask_candidate_amount_done_number)
        & (~mask_blocked_by_pending_rowid if isinstance(mask_blocked_by_pending_rowid, pd.Series) else pd.Series([True] * len(raw), index=raw.index))
        & (~mask_blocked_by_pending_receipt if isinstance(mask_blocked_by_pending_receipt, pd.Series) else pd.Series([True] * len(raw), index=raw.index))
    )

    included_rows = raw[inclusion_mask].copy()
    logger.info(f"📊 Included rows (done in verification): {len(included_rows)} records")
    
    if 'Review Status' in included_rows.columns and not included_rows.empty:
        before_exclude = len(included_rows)
        included_rows = included_rows[included_rows['Review Status'].astype(str).str.lower() != 'rejected'].copy()
        logger.info(f"📊 After excluding rejected from included: {len(included_rows)} records (removed {before_exclude - len(included_rows)})")

    # Process orphaned Done records (exist only in verification tables, not in invoices)
    orphaned_records = []
    
    # Get orphaned Done records from verification_dates
    date_done_orphaned = date[date["Verification Status_clean"] == "done"].copy()
    if not date_done_orphaned.empty and rowid_col_date:
        for _, row in date_done_orphaned.iterrows():
            # Check if this row_id exists in base_df or included_rows
            row_id_val = str(row.get(rowid_col_date, ""))
            if not row_id_val:
                continue
                
            # If not in base_df and not in included_rows, it's orphaned
            in_base = False
            if rowid_col_raw and rowid_col_raw in base_df.columns:
                in_base = base_df[rowid_col_raw].astype(str).str.strip().eq(row_id_val).any()
            
            in_included = False
            if not included_rows.empty and rowid_col_raw and rowid_col_raw in included_rows.columns:
                in_included = included_rows[rowid_col_raw].astype(str).str.strip().eq(row_id_val).any()
            
            if not in_base and not in_included:
                # This is an orphaned record - create synthetic invoice record
                # FIXED: Check if Receipt Link exists (mapped to r2_file_path which is NOT NULL)
                receipt_link = row.get('Receipt Link', '')
                if not receipt_link or str(receipt_link).strip() == '':
                    logger.warning(f"⚠️ Skipping orphaned Date verification record {row_id_val} due to missing Receipt Link")
                    continue

                synthetic_record = {
                    rowid_col_raw: row_id_val,
                    'Receipt Number': row.get('Receipt Number', ''),
                    'Receipt Link': receipt_link,
                    'Date': row.get('Date', None),
                    'Upload Date': row.get('Upload Date', None),
                    'Review Status': 'Verified'
                }
                orphaned_records.append(synthetic_record)
    
    # Get orphaned Done records from verification_amounts  
    amount_done_orphaned = amount[amount["Verification Status_clean"] == "done"].copy()
    if not amount_done_orphaned.empty and rowid_col_amount:
        for _, row in amount_done_orphaned.iterrows():
            row_id_val = str(row.get(rowid_col_amount, ""))
            if not row_id_val:
                continue
            
            # Check if already processed as date orphan or exists in base/included
            already_added = any(r.get(rowid_col_raw) == row_id_val for r in orphaned_records)
            if already_added:
                continue
                
            in_base = False
            if rowid_col_raw and rowid_col_raw in base_df.columns:
                in_base = base_df[rowid_col_raw].astype(str).str.strip().eq(row_id_val).any()
            
            in_included = False
            if not included_rows.empty and rowid_col_raw and rowid_col_raw in included_rows.columns:
                in_included = included_rows[rowid_col_raw].astype(str).str.strip().eq(row_id_val).any()
            
            if not in_base and not in_included:
                # This is an orphaned record - create synthetic invoice record
                # FIXED: Check if Receipt Link exists (mapped to r2_file_path which is NOT NULL)
                receipt_link = row.get('Receipt Link', '')
                if not receipt_link or str(receipt_link).strip() == '':
                    logger.warning(f"⚠️ Skipping orphaned Amount verification record {row_id_val} due to missing Receipt Link")
                    continue

                synthetic_record = {
                    rowid_col_raw: row_id_val,
                    'Receipt Number': row.get('Receipt Number', ''),
                    'Receipt Link': receipt_link,
                    'Description': row.get('Description', ''),
                    'Quantity': row.get('Quantity', None),
                    'Rate': row.get('Rate', None),
                    'Amount': row.get('Amount', None),
                    'Upload Date': row.get('Upload Date', None),
                    'Review Status': 'Verified'
                }
                orphaned_records.append(synthetic_record)
    
    if orphaned_records:
        logger.info(f"📊 Found {len(orphaned_records)} orphaned Done records (not in invoices)")
        # Convert to DataFrame and add to included_rows
        orphaned_df = pd.DataFrame(orphaned_records)
        # Align columns with raw df
        for col in raw.columns:
            if col not in orphaned_df.columns:
                orphaned_df[col] = None
        orphaned_df = orphaned_df.reindex(columns=raw.columns)
        included_rows = pd.concat([included_rows, orphaned_df], ignore_index=True)
        logger.info(f"📊 Total included rows after adding orphaned: {len(included_rows)} records")
    
    if included_rows.empty:
        logger.info(f"📊 No included rows, returning base_df with {len(base_df)} records")
        final_df = base_df.reindex(columns=df_raw.columns)
        return final_df

    # Apply date corrections
    date_done_df = date[date["Verification Status_clean"] == "done"].copy()
    date_apply_cols = []
    if "Receipt Number" in date_done_df.columns:
        date_apply_cols.append("Receipt Number")
    if "Receipt Link" in date_done_df.columns:
        date_apply_cols.append("Receipt Link")
    if "Date" in date_done_df.columns:
        date_apply_cols.append("Date")
    date_apply_cols = ["Receipt Link_clean"] + date_apply_cols
    date_done_sel = date_done_df[date_apply_cols].drop_duplicates(subset=["Receipt Link_clean"], keep="last").copy()
    
    rename_map = {}
    if "Receipt Number" in date_done_sel.columns:
        rename_map["Receipt Number"] = "ReceiptNumber_date_verified"
    if "Receipt Link" in date_done_sel.columns:
        rename_map["Receipt Link"] = "ReceiptLink_date_verified"
    if "Date" in date_done_sel.columns:
        rename_map["Date"] = "Date_date_verified"
    date_done_sel = date_done_sel.rename(columns=rename_map)

    included_rows = included_rows.merge(date_done_sel, on="Receipt Link_clean", how="left", validate="m:1")
    if "ReceiptNumber_date_verified" in included_rows.columns:
        included_rows["Receipt Number"] = included_rows["ReceiptNumber_date_verified"].combine_first(included_rows["Receipt Number"])
    if "ReceiptLink_date_verified" in included_rows.columns:
        included_rows["Receipt Link"] = included_rows["ReceiptLink_date_verified"].combine_first(included_rows["Receipt Link"])
    if "Date_date_verified" in included_rows.columns:
        included_rows["Date"] = included_rows["Date_date_verified"].combine_first(included_rows["Date"])
    for c in ["ReceiptNumber_date_verified", "ReceiptLink_date_verified", "Date_date_verified"]:
        if c in included_rows.columns:
            included_rows.drop(columns=[c], inplace=True)

    # Apply amount corrections
    amount_done_df = amount[amount["Verification Status_clean"] == "done"].copy()
    amt_cols = [c for c in ["Quantity", "Rate", "Amount", "Amount Mismatch"] if c in amount_done_df.columns]
    
    if not amount_done_df.empty and amt_cols:
        amt_merge = pd.DataFrame()
        if rowid_col_amount and rowid_col_amount in amount_done_df.columns:
            amt_merge = amount_done_df[[rowid_col_amount] + amt_cols].copy()
            amt_merge[rowid_col_amount] = amt_merge[rowid_col_amount].astype(str)
            amt_merge = amt_merge.drop_duplicates(subset=[rowid_col_amount], keep="last")
            included_rows[rowid_col_raw] = included_rows.get(rowid_col_raw, pd.Series([""]*len(included_rows))).astype(str)
            
            included_rows = included_rows.merge(
                amt_merge.rename(columns={rowid_col_amount: rowid_col_raw}), 
                on=rowid_col_raw, 
                how="left", 
                suffixes=('', '_verified'),  # FIX: Use empty string instead of None to prevent duplicates
                validate="m:1"
            )
            
            for col in amt_cols:
                verified_col = f"{col}_verified"
                if verified_col in included_rows.columns:
                    included_rows[col] = included_rows[verified_col].combine_first(included_rows[col])
                    included_rows.drop(columns=[verified_col], inplace=True)

    included_rows["Review Status"] = "Verified"

    # Combine base and included
    final_df = pd.concat([base_df, included_rows], ignore_index=True, sort=False)
    logger.info(f"📊 Combined dataframe (base + included): {len(final_df)} records")
    
    for c in ["Receipt Link_clean", "Receipt Number_str", "Upload Date_dt"]:
        if c in final_df.columns:
            final_df.drop(columns=[c], inplace=True, errors="ignore")

    final_cols = [c for c in df_raw.columns if c in final_df.columns]
    other_cols = [c for c in final_df.columns if c not in final_cols]
    final_df = final_df[final_cols + other_cols]
    
    # Deduplicate
    dedup_cols = []
    
    # CRITICAL: Include Row_Id first to ensure each unique line item is preserved
    # Without Row_Id, line items with same Receipt Number + Date + Description would be deduplicated
    if rowid_col_raw and rowid_col_raw in final_df.columns:
        dedup_cols.append(rowid_col_raw)
        logger.info(f"✓ Row_Id column '{rowid_col_raw}' found and will be used for deduplication")
    else:
        logger.warning(f"⚠️ Row_Id column NOT found! rowid_col_raw={rowid_col_raw}, available columns: {list(final_df.columns)}")
    
    if "Receipt Number" in final_df.columns:
        dedup_cols.append("Receipt Number")
    if "Date" in final_df.columns:
        dedup_cols.append("Date")
    if "Description" in final_df.columns:
        dedup_cols.append("Description")
    
    if dedup_cols:
        logger.info(f"Deduplicating on columns: {dedup_cols}")
        initial_count = len(final_df)
        if "Upload Date" in final_df.columns:
            final_df = final_df.sort_values("Upload Date", na_position='first')
        final_df = final_df.drop_duplicates(subset=dedup_cols, keep='last').reset_index(drop=True)
        final_count = len(final_df)
        removed_count = initial_count - final_count
        logger.info(f"Deduplicated Invoice Verified: {final_count} unique records (removed {removed_count} duplicates)")

    return final_df


async def run_sync_verified_logic(sheet_id: str) -> Dict[str, Any]:
    """
    Execute the Sync & Finish workflow:
    1. Read All, Verify Dates, Verify Amount
    2. Apply corrections to Invoice All
    3. Rebuild Invoice Verified
    4. Clean up verification sheets (remove Done/Rejected)
    
    Returns:
        Dictionary with sync results
    """
    sheets_client = get_sheets_client()
    results = {
        "success": False,
        "message": "",
        "records_synced": 0
    }
    
    try:
        logger.info("Starting Sync & Finish workflow")
        
        # 1. Read dataframes
        df_raw = sheets_client.read_sheet_to_df(sheet_id, SHEET_INVOICE_ALL)
        if "Receipt Number" in df_raw.columns:
            df_raw["Receipt Number"] = df_raw["Receipt Number"].astype(str).str.replace(r'\.0$', '', regex=True)
        
        df_date = sheets_client.read_sheet_to_df(sheet_id, SHEET_VERIFY_DATES)
        if "Receipt Number" in df_date.columns:
            df_date["Receipt Number"] = df_date["Receipt Number"].astype(str).str.replace(r'\.0$', '', regex=True)
        
        df_amount = sheets_client.read_sheet_to_df(sheet_id, SHEET_VERIFY_AMOUNT)
        if "Receipt Number" in df_amount.columns:
            df_amount["Receipt Number"] = df_amount["Receipt Number"].astype(str).str.replace(r'\.0$', '', regex=True)

        corrections_made = False
        
        # 2. Apply date/receipt corrections
        if 'Verification Status' in df_date.columns:
            date_done = df_date[df_date['Verification Status'].astype(str).str.lower() == 'done'].copy()
            
            if not date_done.empty:
                logger.info(f"Applying {len(date_done)} date/receipt corrections")
                date_done['Receipt Link_clean'] = date_done['Receipt Link'].astype(str).str.strip()
                date_done['Receipt Number'] = date_done['Receipt Number'].astype(str).str.replace(r'\.0$', '', regex=True)
                date_done['Date'] = date_done['Date'].apply(normalize_date)
                
                for _, row in date_done.iterrows():
                    link = row.get('Receipt Link_clean')
                    new_rec_num = row.get('Receipt Number')
                    new_date = row.get('Date')
                    
                    if not link:
                        continue
                    
                    mask = df_raw['Receipt Link'].astype(str).str.strip() == link
                    if mask.any():
                        if new_rec_num:
                            df_raw.loc[mask, 'Receipt Number'] = new_rec_num
                        if new_date:
                            df_raw.loc[mask, 'Date'] = new_date  # Already normalized to DD-MM-YYYY

                        corrections_made = True

        # 3. Apply amount corrections
        if 'Verification Status' in df_amount.columns:
            amt_done = df_amount[df_amount['Verification Status'].astype(str).str.lower() == 'done'].copy()
            
            if not amt_done.empty:
                logger.info(f"Applying {len(amt_done)} amount corrections")
                
                for _, row in amt_done.iterrows():
                    link = str(row.get('Receipt Link', '')).strip()
                    desc = str(row.get('Description', '')).strip()
                    new_qty = row.get('Quantity')
                    new_rate = row.get('Rate')
                    new_amt = row.get('Amount')
                    new_desc = row.get('Description')  # Get corrected description
                    
                    if not link:
                        continue

                    mask = (
                        (df_raw['Receipt Link'].astype(str).str.strip() == link) & 
                        (df_raw['Description'].astype(str).str.strip() == desc)
                    )
                    
                    if mask.any():
                        # Apply description correction first (if changed)
                        if pd.notna(new_desc) and str(new_desc).strip() != '' and str(new_desc).strip() != desc:
                            df_raw.loc[mask, 'Description'] = new_desc
                        
                        # Apply numeric corrections
                        if pd.notna(new_qty) and str(new_qty) != '':
                            df_raw.loc[mask, 'Quantity'] = new_qty
                        if pd.notna(new_rate) and str(new_rate) != '':
                            df_raw.loc[mask, 'Rate'] = new_rate
                        if pd.notna(new_amt) and str(new_amt) != '':
                            df_raw.loc[mask, 'Amount'] = new_amt
                        

                        corrections_made = True

        # 4. Save updated Invoice All
        if corrections_made:
            logger.info("Updating Invoice All sheet")
            if 'Date' in df_raw.columns:
                df_raw['Date'] = safe_format_date_series(df_raw['Date'], output_format='%Y-%m-%d')
            sheets_client.write_df_to_sheet(df_raw, sheet_id, SHEET_INVOICE_ALL)

        # 5. Build and save Invoice Verified
        final_df = build_verified(df_raw, df_date, df_amount)
        sheets_client.write_df_to_sheet(final_df, sheet_id, SHEET_INVOICE_VERIFIED)
        logger.info(f"Invoice Verified updated with {len(final_df)} rows")

        # 6. Clean up verification sheets - CROSS-SHEET DEPENDENCY
        # A record should only be removed from Verify Dates if:
        #   - It's Done AND the same Receipt Number is Done in Verify Amount (or not in Verify Amount)
        # Same for Verify Amount - check if Done in Verify Dates
        
        # Get Receipt Numbers that are Done in each sheet
        date_done_receipts = set()
        date_pending_receipts = set()
        if 'Verification Status' in df_date.columns and 'Receipt Number' in df_date.columns:
            date_status_lower = df_date['Verification Status'].astype(str).str.lower().str.strip()
            date_done_receipts = set(df_date.loc[date_status_lower == 'done', 'Receipt Number'].astype(str).str.strip())
            date_pending_receipts = set(df_date.loc[date_status_lower.isin(['pending', 'duplicate receipt number']), 'Receipt Number'].astype(str).str.strip())
        
        amount_done_receipts = set()
        amount_pending_receipts = set()
        amount_all_receipts = set()
        if 'Verification Status' in df_amount.columns and 'Receipt Number' in df_amount.columns:
            amount_status_lower = df_amount['Verification Status'].astype(str).str.lower().str.strip()
            amount_done_receipts = set(df_amount.loc[amount_status_lower == 'done', 'Receipt Number'].astype(str).str.strip())
            amount_pending_receipts = set(df_amount.loc[amount_status_lower.isin(['pending', 'duplicate receipt number']), 'Receipt Number'].astype(str).str.strip())
            amount_all_receipts = set(df_amount['Receipt Number'].astype(str).str.strip())
        
        # For Verify Dates: keep if Pending, OR if Done but same Receipt is still Pending in Verify Amount
        if 'Verification Status' in df_date.columns:
            def should_keep_date_record(row):
                status = str(row.get('Verification Status', '')).lower().strip()
                receipt_num = str(row.get('Receipt Number', '')).strip()
                
                # Keep if Pending or Duplicate
                if status in ['pending', 'duplicate receipt number']:
                    return True
                
                # If Done, check if same Receipt is still Pending in Verify Amount
                if status == 'done':
                    # If receipt exists in Verify Amount and is Pending there, keep in Dates
                    if receipt_num in amount_pending_receipts:
                        return True
                    # If receipt exists in Verify Amount but is Done, can delete
                    # If receipt doesn't exist in Verify Amount, can delete
                    return False
                
                # Already Verified, Rejected - can delete
                return False
            
            df_date_clean = df_date[df_date.apply(should_keep_date_record, axis=1)].copy()
            sheets_client.write_df_to_sheet(df_date_clean, sheet_id, SHEET_VERIFY_DATES)
            logger.info(f"Verify Dates cleaned: {len(df_date_clean)} records remain")

        # For Verify Amount: keep if Pending, OR if Done but same Receipt is still Pending in Verify Dates
        if 'Verification Status' in df_amount.columns:
            def should_keep_amount_record(row):
                status = str(row.get('Verification Status', '')).lower().strip()
                receipt_num = str(row.get('Receipt Number', '')).strip()
                
                # Keep if Pending or Duplicate
                if status in ['pending', 'duplicate receipt number']:
                    return True
                
                # If Done, check if same Receipt is still Pending in Verify Dates
                if status == 'done':
                    # If receipt exists in Verify Dates and is Pending there, keep in Amount
                    if receipt_num in date_pending_receipts:
                        return True
                    # If receipt exists in Verify Dates but is Done, can delete
                    # If receipt doesn't exist in Verify Dates, can delete
                    return False
                
                # Already Verified, Rejected - can delete
                return False
            
            df_amount_clean = df_amount[df_amount.apply(should_keep_amount_record, axis=1)].copy()
            sheets_client.write_df_to_sheet(df_amount_clean, sheet_id, SHEET_VERIFY_AMOUNT)
            logger.info(f"Verify Amount cleaned: {len(df_amount_clean)} records remain")

        results["success"] = True
        results["message"] = "Sync & Finish completed successfully"
        results["records_synced"] = len(final_df)
        
    except Exception as e:
        logger.error(f"Error in sync workflow: {e}")
        results["message"] = f"Sync failed: {str(e)}"
        raise
    
    return results
"""
Supabase version of sync-finish logic.
Added to existing verification.py
"""


async def run_sync_verified_logic_supabase(username: str, progress_callback=None) -> Dict[str, Any]:
    """
    Execute the Sync & Finish workflow using Supabase:
    1. Read invoices, verification_dates, verification_amounts from Supabase
    2. Apply corrections to invoices table
    3. Rebuild verified_invoices table
    4. Clean up verification tables (remove Done/Rejected)
    
    Args:
        username: Username for RLS filtering
        progress_callback: Optional async function to report progress
                          Called with (stage, percentage, message)
    
    Returns:
        Dictionary with sync results
    """
    from database_helpers import (
        get_all_invoices,
        get_verification_dates,
        get_verification_amounts,
        update_verified_invoices,
        convert_numeric_types
    )
    from database import get_database_client
    
    # Helper to emit progress
    async def emit_progress(stage: str, percentage: int, message: str):
        if progress_callback:
            await progress_callback(stage, percentage, message)
    
    results = {
        "success": False,
        "message": "",
        "records_synced": 0
    }
    
    try:
        logger.info(f"Starting Sync & Finish workflow for user: {username}")
        await emit_progress("reading", 5, "Reading invoice data...")
        
        # 1. Read data from Supabase (returns list of dicts)
        invoices_data = get_all_invoices(username)
        dates_data = get_verification_dates(username)
        amounts_data = get_verification_amounts(username)
        
        if not invoices_data:
            logger.warning(f"No invoices found for user: {username}")
            results["message"] = "No invoices found"
            return results
        
        # Convert to DataFrames (need to handle snake_case column names)
        df_raw = pd.DataFrame(invoices_data)
        df_date = pd.DataFrame(dates_data) if dates_data else pd.DataFrame()
        df_amount = pd.DataFrame(amounts_data) if amounts_data else pd.DataFrame()
        
        # Map snake_case columns to Title Case for compatibility with build_verified()
        # build_verified() expects Title Case columns from Google Sheets
        column_map = {
            'id': 'Row_Id',                     # invoices.id -> verified_invoices.row_id
            'receipt_number': 'Receipt Number',
            'r2_file_path': 'Receipt Link',     # invoices.r2_file_path -> Receipt Link (CRITICAL FIX)
            'receipt_link': 'Receipt Link_Orig', # Keep original link if needed, but primary is r2_file_path
            'date': 'Date',
            'customer': 'Customer Name',        # invoices.customer -> Customer Name
            'vehicle_number': 'Car Number',     # invoices.vehicle_number -> Car Number
            'description': 'Description',
            'type': 'Type',
            'quantity': 'Quantity',
            'rate': 'Rate',
            'amount': 'Amount',
            'upload_date': 'Upload Date',
            'image_hash': 'Image Hash',
            'verification_status': 'Verification Status',
        }
        
        # Rename columns for processing
        # Note: We prioritize r2_file_path as 'Receipt Link' for correct processing
        df_raw = df_raw.rename(columns=column_map)
        
        # For verification tables, 'receipt_link' is the correct column
        verification_map = column_map.copy()
        verification_map['receipt_link'] = 'Receipt Link' # Override for verification tables
        del verification_map['r2_file_path']
        
        df_date = df_date.rename(columns=verification_map)
        df_amount = df_amount.rename(columns=verification_map)
        
        # Clean Receipt Number (.0 suffix)
        if "Receipt Number" in df_raw.columns:
            df_raw["Receipt Number"] = df_raw["Receipt Number"].astype(str).str.replace(r'\.0$', '', regex=True)
        if "Receipt Number" in df_date.columns:
            df_date["Receipt Number"] = df_date["Receipt Number"].astype(str).str.replace(r'\.0$', '', regex=True)
        if "Receipt Number" in df_amount.columns:
            df_amount["Receipt Number"] = df_amount["Receipt Number"].astype(str).str.replace(r'\.0$', '', regex=True)

        # REPAIR STEP 1: Build a map of Receipt Number -> Receipt Link from all available sources
        # This fixes cases where invoices table has lost the link but verification tables still have it
        receipt_link_map = {}
        
        # 1. Gather from Verify Dates (highest priority for link correctness)
        if hasattr(df_date, 'columns') and 'Receipt Number' in df_date.columns and 'Receipt Link' in df_date.columns:
            valid_dates = df_date.dropna(subset=['Receipt Number', 'Receipt Link'])
            valid_dates = valid_dates[valid_dates['Receipt Link'].astype(str).str.strip() != '']
            for _, row in valid_dates.iterrows():
                r_num = str(row['Receipt Number']).strip()
                r_link = str(row['Receipt Link']).strip()
                if r_num and r_link:
                    receipt_link_map[r_num] = r_link
        
        # 2. Gather from Verify Amounts
        if hasattr(df_amount, 'columns') and 'Receipt Number' in df_amount.columns and 'Receipt Link' in df_amount.columns:
            valid_amts = df_amount.dropna(subset=['Receipt Number', 'Receipt Link'])
            valid_amts = valid_amts[valid_amts['Receipt Link'].astype(str).str.strip() != '']
            for _, row in valid_amts.iterrows():
                r_num = str(row['Receipt Number']).strip()
                r_link = str(row['Receipt Link']).strip()
                # Only add if not already present (prefer dates table source)
                if r_num and r_link and r_num not in receipt_link_map:
                    receipt_link_map[r_num] = r_link
        
        # 3. Gather from Invoices itself (if some siblings have it)
        if hasattr(df_raw, 'columns') and 'Receipt Number' in df_raw.columns and 'Receipt Link' in df_raw.columns:
            valid_raw = df_raw.dropna(subset=['Receipt Number', 'Receipt Link'])
            valid_raw = valid_raw[valid_raw['Receipt Link'].astype(str).str.strip() != '']
            for _, row in valid_raw.iterrows():
                r_num = str(row['Receipt Number']).strip()
                r_link = str(row['Receipt Link']).strip()
                if r_num and r_link and r_num not in receipt_link_map:
                    receipt_link_map[r_num] = r_link
        
        logger.info(f"✓ Built receipt link map for {len(receipt_link_map)} unique receipts")

        # REPAIR STEP 2: Apply the map to missing links in df_raw
        repaired_count = 0
        if 'Receipt Number' in df_raw.columns and 'Receipt Link' in df_raw.columns:
            for idx, row in df_raw.iterrows():
                current_link = row.get('Receipt Link')
                # Check if link is missing or empty
                if pd.isna(current_link) or str(current_link).strip() == '':
                    r_num = str(row.get('Receipt Number', '')).strip()
                    # Try to find a link
                    if r_num in receipt_link_map:
                        new_link = receipt_link_map[r_num]
                        df_raw.at[idx, 'Receipt Link'] = new_link
                        # Also update Receipt Link_Orig if it exists
                        if 'Receipt Link_Orig' in df_raw.columns:
                            df_raw.at[idx, 'Receipt Link_Orig'] = new_link
                        repaired_count += 1
        
        if repaired_count > 0:
            logger.info(f"✨ Repaired {repaired_count} invoice records with missing file links")
        # Some legacy/dev data has null r2_file_path but valid receipt_link (mapped to 'Receipt Link_Orig')
        if 'Receipt Link' in df_raw.columns and 'Receipt Link_Orig' in df_raw.columns:
            # Fill null Receipt Link with Receipt Link_Orig
            df_raw['Receipt Link'] = df_raw['Receipt Link'].fillna(df_raw['Receipt Link_Orig'])
            # Also handle empty strings if any
            mask_empty = df_raw['Receipt Link'].astype(str).str.strip() == ''
            if mask_empty.any():
                df_raw.loc[mask_empty, 'Receipt Link'] = df_raw.loc[mask_empty, 'Receipt Link_Orig']
            
            logger.info("✓ Applied fallback for missing r2_file_path using receipt_link")

        corrections_made = False
        db = get_database_client()
        
        # 2. Apply date/receipt corrections
        if 'Verification Status' in df_date.columns:
            date_done = df_date[df_date['Verification Status'].astype(str).str.lower() == 'done'].copy()
            
            if not date_done.empty:
                logger.info(f"Applying {len(date_done)} date/receipt corrections")
                date_done['Receipt Link_clean'] = date_done['Receipt Link'].astype(str).str.strip()
                date_done['Receipt Number'] = date_done['Receipt Number'].astype(str).str.replace(r'\.0$', '', regex=True)
                date_done['Date'] = date_done['Date'].apply(normalize_date)
                
                for _, row in date_done.iterrows():
                    link = row.get('Receipt Link_clean')
                    new_rec_num = row.get('Receipt Number')
                    new_date = row.get('Date')
                    
                    if not link:
                        continue
                    
                    mask = df_raw['Receipt Link'].astype(str).str.strip() == link
                    if mask.any():
                        if new_rec_num:
                            df_raw.loc[mask, 'Receipt Number'] = new_rec_num
                        if new_date:
                            df_raw.loc[mask, 'Date'] = new_date  # Already normalized to DD-MM-YYYY

                        corrections_made = True

        # 3. Apply amount corrections
        if 'Verification Status' in df_amount.columns:
            amt_done = df_amount[df_amount['Verification Status'].astype(str).str.lower() == 'done'].copy()
            
            if not amt_done.empty:
                logger.info(f"Applying {len(amt_done)} amount corrections")
                
                for _, row in amt_done.iterrows():
                    link = str(row.get('Receipt Link', '')).strip()
                    desc = str(row.get('Description', '')).strip()
                    new_qty = row.get('Quantity')
                    new_rate = row.get('Rate')
                    new_amt = row.get('Amount')
                    new_desc = row.get('Description')
                    
                    if not link:
                        continue

                    mask = (
                        (df_raw['Receipt Link'].astype(str).str.strip() == link) & 
                        (df_raw['Description'].astype(str).str.strip() == desc)
                    )
                    
                    if mask.any():
                        if pd.notna(new_desc) and str(new_desc).strip() != '' and str(new_desc).strip() != desc:
                            df_raw.loc[mask, 'Description'] = new_desc
                        
                        if pd.notna(new_qty) and str(new_qty) != '':
                            df_raw.loc[mask, 'Quantity'] = new_qty
                        if pd.notna(new_rate) and str(new_rate) != '':
                            df_raw.loc[mask, 'Rate'] = new_rate
                        if pd.notna(new_amt) and str(new_amt) != '':
                            df_raw.loc[mask, 'Amount'] = new_amt
                        

                        corrections_made = True

        # 3B. Mark ALL receipts as "Verified" if they are fully Done
        # Collect Done and Pending receipt numbers from both sheets
        date_done_receipts = set()
        date_pending_receipts = set()
        amount_done_receipts = set()
        amount_pending_receipts = set()
        
        if 'Verification Status' in df_date.columns and 'Receipt Number' in df_date.columns:
            date_status_lower = df_date['Verification Status'].astype(str).str.lower().str.strip()
            date_done_receipts = set(df_date.loc[date_status_lower == 'done', 'Receipt Number'].astype(str).str.strip())
            date_pending_receipts = set(df_date.loc[date_status_lower.isin(['pending', 'duplicate receipt number']), 'Receipt Number'].astype(str).str.strip())
        
        if 'Verification Status' in df_amount.columns and 'Receipt Number' in df_amount.columns:
            amount_status_lower = df_amount['Verification Status'].astype(str).str.lower().str.strip()
            amount_done_receipts = set(df_amount.loc[amount_status_lower == 'done', 'Receipt Number'].astype(str).str.strip())
            amount_pending_receipts = set(df_amount.loc[amount_status_lower.isin(['pending', 'duplicate receipt number']), 'Receipt Number'].astype(str).str.strip())
        
        # A receipt is fully verified if:
        # - If it appears in Dates sheet: must be Done (not Pending)
        # - If it appears in Amounts sheet: must be Done (not Pending)
        # - If it doesn't appear in either sheet: it's auto-verified
        all_receipts_in_raw = set(df_raw['Receipt Number'].astype(str).str.strip())
        
        for receipt_num in all_receipts_in_raw:
            appears_in_dates = receipt_num in date_done_receipts or receipt_num in date_pending_receipts
            appears_in_amounts = receipt_num in amount_done_receipts or receipt_num in amount_pending_receipts
            
            is_done_in_dates = receipt_num in date_done_receipts
            is_done_in_amounts = receipt_num in amount_done_receipts
            is_pending_in_dates = receipt_num in date_pending_receipts
            is_pending_in_amounts = receipt_num in amount_pending_receipts
            
            # Mark as Verified if:
            # - Not pending in either sheet
            # - Done in all sheets where it appears
            should_verify = True
            if is_pending_in_dates or is_pending_in_amounts:
                should_verify = False
            elif appears_in_dates and not is_done_in_dates:
                should_verify = False
            elif appears_in_amounts and not is_done_in_amounts:
                should_verify = False
            
            if should_verify:
                mask = df_raw['Receipt Number'].astype(str).str.strip() == receipt_num
                if mask.any():

                    corrections_made = True


        # 4. Save updated invoices to Supabase
        if corrections_made:
            logger.info(f"Updating corrected invoice records in Supabase")
            await emit_progress("saving_invoices", 60, "Saving corrected invoices...")
            
            if 'Date' in df_raw.columns:
                df_raw['Date'] = safe_format_date_series(df_raw['Date'], output_format='%Y-%m-%d')
            
            # Convert back to snake_case for Supabase (INVOICES Table)
            # CRITICAL: We need specific reverse map for invoices usage
            invoice_reverse_map = {v: k for k, v in column_map.items()}
            # Manually fix specific columns for invoices table
            invoice_reverse_map['Receipt Link'] = 'r2_file_path'  # Restore to r2_file_path
            # NOTE: Receipt Link_Orig should map back to receipt_link, so we keep it in the map
            
            df_raw_snake = df_raw.rename(columns=invoice_reverse_map)
            
            # Clean NaN/Inf values (not JSON compliant)
            df_raw_snake = df_raw_snake.replace([float('inf'), float('-inf')], None)
            df_raw_snake = df_raw_snake.where(pd.notna(df_raw_snake), None)
            
            # CRITICAL: Convert empty string dates to None (Supabase rejects empty strings for date columns)
            if 'date' in df_raw_snake.columns:
                df_raw_snake['date'] = df_raw_snake['date'].apply(lambda x: None if x == '' or pd.isna(x) else x)
            
            # OPTIMIZED: Use batch upsert for 10-15x performance improvement
            records_to_upsert = []
            for _, row in df_raw_snake.iterrows():
                row_dict = row.to_dict()
                row_dict['username'] = username
                row_dict = convert_numeric_types(row_dict)
                records_to_upsert.append(row_dict)
            
            updated_count = db.batch_upsert('invoices', records_to_upsert, batch_size=500)
            logger.info(f"✅ Upserted {updated_count} invoice records (preserving all existing data)")

        # 5. Build and save verified_invoices
        await emit_progress("building_verified", 40, "Building verified invoices...")
        final_df = build_verified(df_raw, df_date, df_amount)
        logger.info(f"Built verified dataframe with {len(final_df)} rows")
        
        await emit_progress("saving_verified", 80, "Saving verified invoices...")
        
        # Convert to snake_case for Verified Invoices
        # Use same map as invoices - map Receipt Link back to r2_file_path
        final_df_snake = final_df.rename(columns=invoice_reverse_map)
        
        # CRITICAL: 'Row_Id' was reverse-mapped to 'id', but we need it as 'row_id' for verified_invoices
        # Rename 'id' to 'row_id' to preserve the invoices.id integer value
        if 'id' in final_df_snake.columns:
            final_df_snake = final_df_snake.rename(columns={'id': 'row_id'})
            logger.info(f"✅ Mapped invoices.id to verified_invoices.row_id for {len(final_df_snake)} records")
        
        # Clean NaN/Inf values (not JSON compliant)
        final_df_snake = final_df_snake.replace([float('inf'), float('-inf')], None)
        final_df_snake = final_df_snake.where(pd.notna(final_df_snake), None)
        
        # Map column names from invoices schema to verified_invoices schema
        # invoices has: customer, vehicle_number
        # verified_invoices has: customer_name, car_number
        if 'customer' in final_df_snake.columns:
            final_df_snake = final_df_snake.rename(columns={'customer': 'customer_name'})
        if 'vehicle_number' in final_df_snake.columns:
            final_df_snake = final_df_snake.rename(columns={'vehicle_number': 'car_number'})
        
        # Remove columns that exist in 'invoices' but NOT in 'verified_invoices'
        # NOTE: 'id' has already been renamed to 'row_id' above, so no need to exclude it
        columns_to_exclude = [
            'updated_at',           # Only in invoices table
            'Review Status',         # Only used internally, not in verified_invoices table
            'Receipt Link_Orig'     # Intermediate column
        ]
        
        for col in columns_to_exclude:
            if col in final_df_snake.columns:
                final_df_snake = final_df_snake.drop(columns=[col])
        
        # CRITICAL FIX: Remove duplicate column names before converting to dict
        # Pandas silently omits duplicate columns when calling to_dict(), causing data loss
        if final_df_snake.columns.duplicated().any():
            duplicate_cols = final_df_snake.columns[final_df_snake.columns.duplicated()].tolist()
            logger.warning(f"⚠️ Found duplicate column names: {duplicate_cols}. Removing duplicates...")
            final_df_snake = final_df_snake.loc[:, ~final_df_snake.columns.duplicated(keep='last')]
            logger.info(f"✓ Removed duplicate columns. Final columns: {len(final_df_snake.columns)}")
        
        # CRITICAL FIX: Final deduplication on row_id to prevent PostgreSQL ON CONFLICT error
        # verified_invoices has UNIQUE constraint on row_id, so we MUST ensure no duplicates
        if 'row_id' in final_df_snake.columns:
            initial_count = len(final_df_snake)
            # Keep the last occurrence (most recent) for each row_id
            final_df_snake = final_df_snake.drop_duplicates(subset=['row_id'], keep='last')
            removed = initial_count - len(final_df_snake)
            if removed > 0:
                logger.warning(f"⚠️ Removed {removed} duplicate row_id values to prevent database conflict")
        
        final_records = final_df_snake.to_dict('records')
        
        # Save to verified_invoices table
        update_verified_invoices(username, final_records)
        logger.info(f"verified_invoices updated with {len(final_records)} rows")

        # 6. Clean up verification tables - CROSS-SHEET DEPENDENCY
        await emit_progress("cleanup", 95, "Cleaning up verification tables...")
        
        # Get Receipt Numbers that are Done in each table
        date_done_receipts = set()
        date_pending_receipts = set()
        if 'Verification Status' in df_date.columns and 'Receipt Number' in df_date.columns:
            date_status_lower = df_date['Verification Status'].astype(str).str.lower().str.strip()
            date_done_receipts = set(df_date.loc[date_status_lower == 'done', 'Receipt Number'].astype(str).str.strip())
            date_pending_receipts = set(df_date.loc[date_status_lower.isin(['pending', 'duplicate receipt number']), 'Receipt Number'].astype(str).str.strip())
        
        amount_done_receipts = set()
        amount_pending_receipts = set()
        if 'Verification Status' in df_amount.columns and 'Receipt Number' in df_amount.columns:
            amount_status_lower = df_amount['Verification Status'].astype(str).str.lower().str.strip()
            amount_done_receipts = set(df_amount.loc[amount_status_lower == 'done', 'Receipt Number'].astype(str).str.strip())
            amount_pending_receipts = set(df_amount.loc[amount_status_lower.isin(['pending', 'duplicate receipt number']), 'Receipt Number'].astype(str).str.strip())
        
        # === Step 5: Clean Verification Sheets (remove 'Done' records) ===
        # Keep only Pending and Duplicate Receipt Number records for user review
        # Import helper function for updating verification tables
        from database_helpers import update_verification_records
        
        # Create a reverse map specifically for verification tables (keeps receipt_link)
        verification_reverse_map = {v: k for k, v in verification_map.items()}
        # Ensure we map 'Receipt Link' -> 'receipt_link' for verification tables
        verification_reverse_map['Receipt Link'] = 'receipt_link'
        
        # Clean verification_dates
        if 'Verification Status' in df_date.columns:
            # Keep Pending and Duplicate Receipt Number records
            # CRITICAL FIX: Also keep Done records if the same receipt has pending amounts
            def should_keep_date_record(row):
                status = str(row.get('Verification Status', '')).lower().strip()
                receipt_num = str(row.get('Receipt Number', '')).strip()
                
                # Keep if Pending or Duplicate
                if status in ['pending', 'duplicate receipt number']:
                    return True
                
                # If Done, check if same Receipt is still Pending in Verify Amount
                if status == 'done':
                    # If receipt exists in Verify Amount and is Pending there, keep in Dates
                    if receipt_num in amount_pending_receipts:
                        return True
                    # If receipt exists in Verify Amount but is Done, can delete
                    # If receipt doesn't exist in Verify Amount, can delete
                    return False
                
                # Already Verified, Rejected - can delete
                return False
            
            df_date_clean = df_date[df_date.apply(should_keep_date_record, axis=1)].copy()
            df_date_clean_snake = df_date_clean.rename(columns=verification_reverse_map)
            
            # Clean NaN/Inf values (not JSON compliant)
            df_date_clean_snake = df_date_clean_snake.replace([float('inf'), float('-inf')], None)
            df_date_clean_snake = df_date_clean_snake.where(pd.notna(df_date_clean_snake), None)
            
            clean_date_records = df_date_clean_snake.to_dict('records')
            
            # Update verification_dates
            update_verification_records(username, 'verification_dates', clean_date_records)
            logger.info(f"verification_dates cleaned: {len(clean_date_records)} records remain")

        # Clean verification_amounts
        if 'Verification Status' in df_amount.columns:
            def should_keep_amount_record(row):
                status = str(row.get('Verification Status', '')).lower().strip()
                receipt_num = str(row.get('Receipt Number', '')).strip()
                
                if status in ['pending', 'duplicate receipt number']:
                    return True
                
                if status == 'done':
                    if receipt_num in date_pending_receipts:
                        return True
                    return False
                
                return False
            
            df_amount_clean = df_amount[df_amount.apply(should_keep_amount_record, axis=1)].copy()
            df_amount_clean_snake = df_amount_clean.rename(columns=verification_reverse_map)
            
            # Clean NaN/Inf values (not JSON compliant)
            df_amount_clean_snake = df_amount_clean_snake.replace([float('inf'), float('-inf')], None)
            df_amount_clean_snake = df_amount_clean_snake.where(pd.notna(df_amount_clean_snake), None)
            
            clean_amount_records = df_amount_clean_snake.to_dict('records')
            
            # Update verification_amounts
            update_verification_records(username, 'verification_amounts', clean_amount_records)
            logger.info(f"verification_amounts cleaned: {len(clean_amount_records)} records remain")

        results["success"] = True
        results["message"] = "Sync & Finish completed successfully"
        results["records_synced"] = len(final_records)
        
    except Exception as e:
        logger.error(f"Error in Supabase sync workflow: {e}")
        results["message"] = f"Sync failed: {str(e)}"
        raise
    
    return results
