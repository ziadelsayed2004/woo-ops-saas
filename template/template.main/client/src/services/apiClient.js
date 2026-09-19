/**
 * Custom API Client for مطبعة حمزة
 * Automatically handles credentials (Express session cookies) and JSON serialization.
 */

class ApiError extends Error {
  constructor(status, message, data = {}) {
    super(message || `API Error: ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

async function request(path, options = {}) {
  const url = path.startsWith('/api') ? path : `/api${path}`;
  
  const headers = {
    'Accept': 'application/json',
    ...options.headers,
  };

  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    if (typeof options.body === 'object') {
      options.body = JSON.stringify(options.body);
    }
  }

  const fetchOptions = {
    ...options,
    headers,
    credentials: 'include', // CRITICAL: Includes cookie-based Express sessions
  };

  try {
    const response = await fetch(url, fetchOptions);
    
    // Check for empty response or redirect
    const contentType = response.headers.get('content-type');
    let data = {};
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = { message: await response.text() };
    }

    if (!response.ok) {
      throw new ApiError(
        response.status,
        data.message || data.error || `HTTP ${response.status}`,
        data
      );
    }

    return data;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, error.message || 'Network error occurred');
  }
}

export const apiClient = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
};
