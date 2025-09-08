# Background Image Setup

## Adding the Poker Background Image

To properly display the poker table background:

1. **Find a suitable poker background image**:
   - Recommended: Dark green felt poker table or casino background
   - High resolution (1920x1080 or higher)
   - JPG format for best performance

2. **Place the image in the correct location**:
   - Save your image as: `/public/images/poker-bg.jpg`
   - Make sure the `public/images/` directory exists
   - Replace the placeholder file that's currently there

3. **Verify the setup**:
   - The image should load automatically when `showBackground={true}` is passed to PokerTable
   - A dark overlay (40% opacity) will be applied over the image for text readability
   - The UI elements will appear on top with proper z-index layering

## Fallback

If the image fails to load, a green gradient background will be shown instead to maintain the poker theme.

## File Structure
```
public/
├── images/
│   └── poker-bg.jpg  (Your poker background image)
```

## Example Images
Good poker background images can be found at:
- Unsplash.com (search "poker table", "casino felt")
- Free stock photo sites
- Casino/poker themed backgrounds

Make sure any image you use is royalty-free or properly licensed for your project.