import { getStoredToken } from "../cli/command/auth/auth.js";
import { env } from "../env.js";

export async function getGithubAccessToken() {
    const session = await getStoredToken();

    if(!session){
        throw new Error("Please login first.");
    }

    const response = await fetch(
        `${env.BACKEND_URL}/api/github/access-token`,
        {
            headers: {
                Authorization:`Bearer ${session.access_token}`
            }
        }
    );

    if(!response.ok) {
        throw new Error("Failed to fetch GitHub access token.");
    }

    const data = await response.json();

    return data.accessToken;
}