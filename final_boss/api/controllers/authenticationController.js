'use strict';

const JWT   = require('jsonwebtoken');
const Boom = require('boom');
const Promise = require('promise');
const Joi = require('joi');

const key = '666';
const algorithm = 'HS256';

const findUserAndAuthenticate = function (request, reply) {

    let token = '';
    return new Promise((resolve, reject) => {

        request.models.User.findOne({ email: request.payload.email })
            .then((entity) => {

                if (!entity) {
                    return reject(Boom.unauthorized());
                }

                if (!entity.verifyPasswordSync(request.payload.password)) {
                    return reject(Boom.unauthorized());
                }

                entity.authentications.push({
                    strategy: 'jwt',
                    agent: request.headers['user-agent'],
                    ip: request.info.remoteAddress
                });

                const id = entity.authentications[ entity.authentications.length - 1 ]._id;
                const tokenOptions = {
                    jwtid: id.toString(),
                    algorithm: algorithm
                };

                token = JWT.sign({ user: entity.toJSON() }, key, tokenOptions);
                return entity.save();
            })
            .then(() => {

                resolve(token);
            })
            .catch((err) => {

                reject(err);
            });
    });
};

function removeActiveAuthenticationHandler(request, reply) {

    request.models.User.findById(request.auth.credentials.user._id)
        .then((entity) => {

            entity.authentications.forEach((authentication, index) => {
                if (authentication._id.toString() === request.auth.credentials.jti.toString()) {
                    entity.authentications.splice(index, 1);
                    entity.save();
                }
            });

            return reply();
        })
        .catch((err) => {

            return reply(Boom.wrap(err));
        });
};

exports.register = function (server, options, next) {

    const validate = function (decoded, request, callback) {

        request.models.User.findById(decoded.user._id)
            .then((entity) => {

                if ( !entity || !entity.authentications ) {
                    return callback (Boom.unauthorized(), false);
                }

                const authentication = entity.authentications.id(decoded.jti);

                if (authentication) {
                    request.auth.entity = entity;
                    return callback(null, true);
                } else {
                    return callback(Boom.unauthorized(), false);
                }
            })
            .catch((err) => {

                return callback(err, null);
            });
    };

    server.auth.strategy('jwt', 'jwt', {
        key: key,                                       // Never Share your secret key
        validateFunc: validate,                         // validate function defined above
        verifyOptions: { algorithms: [ algorithm ] }    // pick a strong algorithm
    });

    server.route({
        method: 'POST',
        path:'/api/auth',
        config: {
            handler: authHandler,
            validate: {
                payload: Joi.object().keys({
                    email: Joi.string().required(),
                    password: Joi.string().max(30).required()
                })
            }
        }
    });

    server.route({
        method: 'DELETE',
        path: '/api/auth',
        handler: removeActiveAuthenticationHandler,
        config: {
            auth: 'jwt'
        }
    });

    function authHandler(request, reply) {
        findUserAndAuthenticate(request)
            .then((token) => {

                reply({ token: token });
            })
            .catch((err) => {

                reply(Boom.wrap(err));
                throw err;
            });
    }

    next();
};

exports.register.attributes = {
    name: 'authenticationController',
    version: '0.0.1',
    once: true,
    dependencies: ['hapi-auth-jwt2', 'finalboss-mongoose-connection', 'finalboss-models']
};