const bcrypt = require('bcrypt');
const usersService = require('../users/usersService');

/**
 * Authenticates a user with username and password.
 */
async function authenticate(username, password) {
  if (!username || !password) {
    throw new Error('Username and password are required');
  }
  
  const user = await usersService.findByUsername(username);
  if (!user) {
    return null; // User not found
  }
  
  // A disabled/archived user cannot login
  if (user.status !== 'active') {
    throw new Error('Account is deactivated. Please contact an administrator.');
  }
  
  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    return null; // Password mismatch
  }
  
  // Return user info without password hash
  const { password_hash, ...userProfile } = user;
  return userProfile;
}

module.exports = {
  authenticate
};
