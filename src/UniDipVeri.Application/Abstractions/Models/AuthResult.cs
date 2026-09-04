namespace UniDipVeri.Application.Abstractions.Models;

public sealed record AuthResult(bool IsSuccess, SessionToken? Token = null, string? Error = null)
{
    public static AuthResult Success(SessionToken token) => new(true, token);
    public static AuthResult Failure(string error) => new(false, Error: error);
}

public sealed record SessionToken(string Value, DateTime ExpiresAt);