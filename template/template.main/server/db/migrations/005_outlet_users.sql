-- Bookstore Manager Modernized - Outlet Users Association Schema

CREATE TABLE IF NOT EXISTS outlet_users (
  outlet_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (outlet_id, user_id),
  FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
