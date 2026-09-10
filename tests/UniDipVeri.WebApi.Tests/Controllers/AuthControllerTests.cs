using System.Security.Claims;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;
using UniDipVeri.Application.Features.Auth.Abstractions;
using UniDipVeri.Application.Features.Auth.Models;
using UniDipVeri.WebApi.Controllers;

namespace UniDipVeri.WebApi.Tests.Controllers;

public class AuthControllerTests
{
    private readonly Mock<IAuthService> _authServiceMock = new();
    private readonly Mock<IAuthenticationService> _authenticationServiceMock = new();
    private readonly AuthController _controller;

    public AuthControllerTests()
    {
        _controller = new AuthController(_authServiceMock.Object);

        var serviceProviderMock = new Mock<IServiceProvider>();
        serviceProviderMock
            .Setup(sp => sp.GetService(typeof(IAuthenticationService)))
            .Returns(_authenticationServiceMock.Object);

        _controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                RequestServices = serviceProviderMock.Object
            }
        };
    }

    [Fact]
    public async Task GetCurrentUser_ShouldReturn401_WhenUserIsNotAuthenticated()
    {
        // Act
        var result = await _controller.GetCurrentUser();

        // Assert
        result.Should().BeOfType<UnauthorizedObjectResult>();
    }

    [Fact]
    public async Task GetCurrentUser_ShouldReturn200WithEnrichedProfile_WhenUserIsAuthenticated()
    {
        // Arrange
        var userId = Guid.NewGuid();
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
            new Claim(ClaimTypes.Email, "staff@test.com"),
            new Claim(ClaimTypes.Role, "ADMIN"),
            new Claim("user_type", "staff")
        };
        _controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(claims, "TestCookie"));

        var profile = new UserProfileResponse(
            userId,
            "staff@test.com",
            "Admin User",
            "ADMIN",
            ["ADMIN"],
            "staff",
            null,
            "Mekong International University");

        _authServiceMock.Setup(s => s.GetUserProfileAsync(userId, "staff", It.IsAny<CancellationToken>()))
            .ReturnsAsync(profile);

        // Act
        var result = await _controller.GetCurrentUser();

        // Assert
        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;
        okResult.Value.Should().NotBeNull();
    }

    [Fact]
    public async Task RequestPasswordReset_ShouldAlwaysReturn200_AntiEnumeration()
    {
        // Arrange
        var request = new ResetPasswordRequest("any@test.com");

        // Act
        var result = await _controller.RequestPasswordReset(request);

        // Assert
        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;
        okResult.StatusCode.Should().Be(StatusCodes.Status200OK);
        _authServiceMock.Verify(s => s.RequestPasswordResetAsync("any@test.com", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ConfirmPasswordReset_ShouldReturn400_WhenRequestIsInvalid()
    {
        // Act
        var result = await _controller.ConfirmPasswordReset(new ConfirmResetPasswordRequest("", ""));

        // Assert
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task ConfirmPasswordReset_ShouldReturn200_WhenResetSucceeds()
    {
        // Arrange
        var request = new ConfirmResetPasswordRequest("valid_token", "ValidPassword123!");
        _authServiceMock.Setup(s => s.ConfirmPasswordResetAsync("valid_token", "ValidPassword123!", It.IsAny<CancellationToken>()))
            .ReturnsAsync((true, null));

        // Act
        var result = await _controller.ConfirmPasswordReset(request);

        // Assert
        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;
        okResult.StatusCode.Should().Be(StatusCodes.Status200OK);
    }

    [Fact]
    public async Task ConfirmPasswordReset_ShouldReturn400_WhenServiceFails()
    {
        // Arrange
        var request = new ConfirmResetPasswordRequest("invalid_token", "ValidPassword123!");
        _authServiceMock.Setup(s => s.ConfirmPasswordResetAsync("invalid_token", "ValidPassword123!", It.IsAny<CancellationToken>()))
            .ReturnsAsync((false, "Invalid or expired reset token."));

        // Act
        var result = await _controller.ConfirmPasswordReset(request);

        // Assert
        var badRequest = result.Should().BeOfType<BadRequestObjectResult>().Subject;
        badRequest.StatusCode.Should().Be(StatusCodes.Status400BadRequest);
    }

    [Fact]
    public async Task ChangePassword_ShouldReturn400_WhenRequestIsMissingFields()
    {
        // Act
        var result = await _controller.ChangePassword(new ChangePasswordRequest("", ""));

        // Assert
        result.Should().BeOfType<BadRequestObjectResult>();
    }

    [Fact]
    public async Task ChangePassword_ShouldReturn200AndReissueCookie_WhenSuccessful()
    {
        // Arrange
        var userId = Guid.NewGuid();
        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, userId.ToString()),
            new Claim(ClaimTypes.Email, "student@test.com"),
            new Claim(ClaimTypes.Role, "STUDENT"),
            new Claim("user_type", "student"),
            new Claim("security_stamp", "old_stamp")
        };
        _controller.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme));

        _authServiceMock.Setup(s => s.ChangePasswordAsync(userId, "student", "CurrentPass123!", "NewPass123!", It.IsAny<CancellationToken>()))
            .ReturnsAsync((true, null, "new_security_stamp_123"));

        _authenticationServiceMock
            .Setup(a => a.SignInAsync(
                _controller.HttpContext,
                CookieAuthenticationDefaults.AuthenticationScheme,
                It.IsAny<ClaimsPrincipal>(),
                It.IsAny<AuthenticationProperties>()))
            .Returns(Task.CompletedTask);

        // Act
        var result = await _controller.ChangePassword(new ChangePasswordRequest("CurrentPass123!", "NewPass123!"));

        // Assert
        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;
        okResult.StatusCode.Should().Be(StatusCodes.Status200OK);

        _authenticationServiceMock.Verify(a => a.SignInAsync(
            _controller.HttpContext,
            CookieAuthenticationDefaults.AuthenticationScheme,
            It.Is<ClaimsPrincipal>(p => p.Claims.Any(c => c.Type == "security_stamp" && c.Value == "new_security_stamp_123")),
            It.IsAny<AuthenticationProperties>()), Times.Once);
    }

    [Fact]
    public async Task Logout_ShouldReturn200_AndSignOut()
    {
        // Arrange
        _authenticationServiceMock
            .Setup(a => a.SignOutAsync(_controller.HttpContext, CookieAuthenticationDefaults.AuthenticationScheme, null))
            .Returns(Task.CompletedTask);

        // Act
        var result = await _controller.Logout();

        // Assert
        var okResult = result.Should().BeOfType<OkObjectResult>().Subject;
        okResult.StatusCode.Should().Be(StatusCodes.Status200OK);
    }
}
