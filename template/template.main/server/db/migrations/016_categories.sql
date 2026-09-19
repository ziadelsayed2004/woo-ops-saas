-- 1. Create categories table
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create product_categories junction table
CREATE TABLE IF NOT EXISTS product_categories (
  product_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  PRIMARY KEY (product_id, category_id),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

-- 3. Migrate existing category text strings from products into the new categories table
INSERT OR IGNORE INTO categories (name)
SELECT DISTINCT category 
FROM products 
WHERE category IS NOT NULL AND category != '';

-- 4. Map existing products to their corresponding categories in the junction table
INSERT OR IGNORE INTO product_categories (product_id, category_id)
SELECT p.id, c.id
FROM products p
JOIN categories c ON p.category = c.name
WHERE p.category IS NOT NULL AND p.category != '';
