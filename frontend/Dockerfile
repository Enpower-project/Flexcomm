FROM node:20-alpine

WORKDIR /app

# Dependencies first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci

COPY public ./public
COPY src ./src

ENV BROWSER=none
EXPOSE 3000

# CRA dev server: reads REACT_APP_* from the container environment at startup,
# so Keycloak/API settings come from docker-compose env_file, not the image.
CMD ["npm", "start"]
