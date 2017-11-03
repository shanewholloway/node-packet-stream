FROM node:8.9.0 as base

FROM node:8.9.0 as build_prod
WORKDIR /usr/src/app
COPY approot/package.json /usr/src/app/
RUN NODE_ENV=production npm install --prod
COPY approot/copied_packages /usr/src/app/copied_packages/
RUN npm run :move_packages

FROM node:8.9.0 as build_dev
WORKDIR /usr/src/app
COPY approot/package.json /usr/src/app/
RUN NODE_ENV=development npm install
COPY approot/ /usr/src/app/
RUN npm run build

FROM debian:jessie as final
WORKDIR /usr/src/app
CMD [ "/usr/local/bin/node", "./dist/main.js" ]
COPY --from=base /usr/local/bin/node /usr/local/bin/node
COPY --from=build_prod /usr/src/app/ /usr/src/app/
COPY --from=build_dev /usr/src/app/dist/ /usr/src/app/dist/

