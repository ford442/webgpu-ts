module.exports = function override(config, env) {
    config.devServer = {
        ...config.devServer,
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        },
    };
    return config;
}
