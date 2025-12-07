// Mobile Support for GHOSTCORD
// Add this line before closing </body> tag: <script src="mobile.js"></script>

(function() {
  // Create mobile menu buttons
  function createMobileButtons() {
    // Only create if they don't exist
    if (document.getElementById('mobileChannelsBtn')) return;

    // Channels button
    const channelsBtn = document.createElement('button');
    channelsBtn.id = 'mobileChannelsBtn';
    channelsBtn.className = 'mobile-menu-btn mobile-channels-btn';
    channelsBtn.innerHTML = '☰';
    channelsBtn.onclick = toggleChannels;
    document.body.appendChild(channelsBtn);

    // Servers button
    const serversBtn = document.createElement('button');
    serversBtn.id = 'mobileServersBtn';
    serversBtn.className = 'mobile-menu-btn mobile-servers-btn';
    serversBtn.innerHTML = '📁';
    serversBtn.onclick = toggleServers;
    document.body.appendChild(serversBtn);
  }

  // Toggle channels sidebar
  function toggleChannels() {
    const channels = document.getElementById('channels');
    const servers = document.getElementById('servers');
    
    if (channels.classList.contains('show')) {
      channels.classList.remove('show');
    } else {
      channels.classList.add('show');
      servers.classList.remove('show');
    }
  }

  // Toggle servers sidebar
  function toggleServers() {
    const servers = document.getElementById('servers');
    const channels = document.getElementById('channels');
    
    if (servers.classList.contains('show')) {
      servers.classList.remove('show');
    } else {
      servers.classList.add('show');
      channels.classList.remove('show');
    }
  }

  // Close menus when clicking outside or on chat
  function closeMobileMenus() {
    if (window.innerWidth <= 768) {
      document.getElementById('channels')?.classList.remove('show');
      document.getElementById('servers')?.classList.remove('show');
    }
  }

  // Close menus when selecting a channel or server
  function setupAutoClose() {
    // Wait for DOM to be ready
    setTimeout(() => {
      const chatArea = document.getElementById('chatArea');
      const messages = document.getElementById('messages');
      const app = document.getElementById('app');

      if (chatArea) {
        chatArea.addEventListener('click', closeMobileMenus);
      }
      if (messages) {
        messages.addEventListener('click', closeMobileMenus);
      }
      if (app) {
        app.addEventListener('click', (e) => {
          // Don't close if clicking on servers or channels themselves
          if (!e.target.closest('#servers') && !e.target.closest('#channels')) {
            closeMobileMenus();
          }
        });
      }

      // Close when selecting a channel
      const channelList = document.getElementById('channelList');
      if (channelList) {
        channelList.addEventListener('click', () => {
          setTimeout(closeMobileMenus, 100);
        });
      }

      // Close when selecting a server
      const servers = document.getElementById('servers');
      if (servers) {
        servers.addEventListener('click', (e) => {
          if (e.target.classList.contains('srv') && !e.target.classList.contains('add')) {
            setTimeout(closeMobileMenus, 100);
          }
        });
      }

      // Close when switching tabs
      const tabs = document.querySelectorAll('.tab');
      tabs.forEach(tab => {
        tab.addEventListener('click', closeMobileMenus);
      });
    }, 1000);
  }

  // Prevent zoom on double tap for inputs (iOS)
  function preventZoom() {
    const inputs = document.querySelectorAll('input, textarea, select');
    inputs.forEach(input => {
      input.addEventListener('touchend', (e) => {
        e.preventDefault();
        input.focus();
      }, { passive: false });
    });
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    createMobileButtons();
    setupAutoClose();
    
    // Add viewport meta if missing
    if (!document.querySelector('meta[name="viewport"]')) {
      const meta = document.createElement('meta');
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
      document.head.appendChild(meta);
    }

    // Expose functions globally for use in existing code
    window.toggleChannels = toggleChannels;
    window.toggleServers = toggleServers;
    window.closeMobileMenus = closeMobileMenus;
  }

  // Handle orientation change
  window.addEventListener('orientationchange', () => {
    closeMobileMenus();
  });

  // Handle resize
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (window.innerWidth > 768) {
        closeMobileMenus();
      }
    }, 250);
  });
})();
