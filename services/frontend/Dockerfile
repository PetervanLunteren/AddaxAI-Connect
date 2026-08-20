# Multi-stage build for production
# node 22: react-dropzone 20 declares engines node >= 22, and vite 8 wants
# ^20.19 || >=22.12. Node 20 satisfied vite but not react-dropzone.
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
