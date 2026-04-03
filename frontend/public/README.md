# Logo Integration Instructions

To add your Stocket logo:

1. **Place your logo file here**: Add your logo image (PNG, SVG, or JPG) to this `public` folder
   - Recommended name: `logo.png` or `logo.svg`
   - Recommended size: Around 200x200px for optimal display

2. **The logo will be automatically integrated** into:
   - Login page (replacing the text logo)
   - Dashboard navigation (replacing the text logo)

3. **Logo requirements**:
   - Transparent background works best
   - Gold/yellow color scheme to match the theme
   - High resolution for crisp display

## Current Integration Points

Once you add your logo file as `logo.png` or `logo.svg`, the application will automatically use it in:

- Login page center display
- Dashboard navigation header
- Loading states

## Alternative Logo Names

If you use a different filename, update the imports in:
- `src/App.js` (line ~59)
- `src/Dashboard.js` (line ~199)

Change `./logo.png` to your actual filename.
