# Script to add hyperlink formatting to Excel export
# Add this code after line 583 in inventory.py (after worksheet.column_dimensions[column_letter].width = adjusted_width)

hyperlink_code = """
            # Convert receipt links to clickable hyperlinks
            from openpyxl.styles import Font, colors
            receipt_link_col = None
            for idx, col in enumerate(worksheet[1], 1):  # Header row
                if col.value == 'Receipt Link':
                    receipt_link_col = idx
                    break
            
            if receipt_link_col:
                for row_idx in range(2, worksheet.max_row + 1):  # Skip header
                    cell = worksheet.cell(row=row_idx, column=receipt_link_col)
                    if cell.value and str(cell.value).startswith('http'):
                        cell.hyperlink = cell.value
                        cell.value = 'View Image'
                        cell.font = Font(color=colors.BLUE, underline='single')
"""

print("Add the following code after line 583 in backend/routes/inventory.py:")
print("="*80)
print(hyperlink_code)
print("="*80)
