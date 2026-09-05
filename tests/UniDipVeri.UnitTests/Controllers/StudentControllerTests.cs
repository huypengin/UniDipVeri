using System.Reflection;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc;
using Moq;
using UniDipVeri.Application.Abstractions.Models;
using UniDipVeri.Application.Abstractions.Services;
using UniDipVeri.Application.Features.Auth.Models;
using UniDipVeri.WebApi.Controllers;

namespace UniDipVeri.UnitTests.Controllers;

public class StudentControllerTests
{
    private readonly Mock<IAuthService> _authServiceMock = new();
    private readonly StudentController _controller;

    public StudentControllerTests()
    {
        _controller = new StudentController(_authServiceMock.Object);
    }

    [Fact]
    public void StudentController_ShouldHaveRouteAttribute_AndLoginActionShouldHavePostAuthLogin()
    {
        // Assert controller has ApiController and Route
        typeof(StudentController).GetCustomAttribute<ApiControllerAttribute>().Should().NotBeNull();
        var routeAttr = typeof(StudentController).GetCustomAttribute<RouteAttribute>();
        routeAttr.Should().NotBeNull();

        // Assert Login method has HttpPostAttribute matching /api/auth/login
        var method = typeof(StudentController).GetMethod(nameof(StudentController.Login));
        method.Should().NotBeNull();

        var postAttrs = method!.GetCustomAttributes<HttpPostAttribute>().ToList();
        postAttrs.Should().Contain(a => a.Template == "/api/auth/login");
    }

    [Fact]
    public async Task Login_ShouldReturn200WithSessionToken_WhenStudentCredentialsAreValid()
    {
        // Arrange
        var studentId = Guid.NewGuid();
        var request = new LoginRequest("student@miu.edu", "Password123!");
        var expectedToken = new SessionToken("jwt-token-student-123", DateTime.UtcNow.AddHours(8));

        _authServiceMock.Setup(s => s.AuthenticateStudentAsync(request.Email, request.Password, It.IsAny<CancellationToken>()))
            .ReturnsAsync(AuthResult.Success(expectedToken));

        // Act
        var result = await _controller.Login(request, CancellationToken.None);

        // Assert
        result.Should().BeOfType<OkObjectResult>();
        var okResult = (OkObjectResult)result;
        okResult.StatusCode.Should().Be(200);

        var token = okResult.Value as SessionToken;
        token.Should().NotBeNull();
        token!.Value.Should().Be("jwt-token-student-123");

        _authServiceMock.Verify(s => s.AuthenticateStudentAsync(request.Email, request.Password, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Login_ShouldReturn401_WhenStudentAccountDoesNotExist()
    {
        // Arrange
        var request = new LoginRequest("unknown@miu.edu", "Password123!");
        _authServiceMock.Setup(s => s.AuthenticateStudentAsync(request.Email, request.Password, It.IsAny<CancellationToken>()))
            .ReturnsAsync(AuthResult.Failure("Invalid email or password."));

        // Act
        var result = await _controller.Login(request, CancellationToken.None);

        // Assert
        result.Should().BeOfType<UnauthorizedObjectResult>();
        var unauthorizedResult = (UnauthorizedObjectResult)result;
        unauthorizedResult.StatusCode.Should().Be(401);
    }

    [Fact]
    public async Task Login_ShouldReturn401_WhenPasswordIsIncorrect()
    {
        // Arrange
        var request = new LoginRequest("student@miu.edu", "WrongPassword!");
        _authServiceMock.Setup(s => s.AuthenticateStudentAsync(request.Email, request.Password, It.IsAny<CancellationToken>()))
            .ReturnsAsync(AuthResult.Failure("Invalid email or password."));

        // Act
        var result = await _controller.Login(request, CancellationToken.None);

        // Assert
        result.Should().BeOfType<UnauthorizedObjectResult>();
        var unauthorizedResult = (UnauthorizedObjectResult)result;
        unauthorizedResult.StatusCode.Should().Be(401);
    }

    [Fact]
    public async Task Login_ShouldReturn401_WhenStudentAccountIsInactive()
    {
        // Arrange
        var request = new LoginRequest("inactive@miu.edu", "Password123!");
        _authServiceMock.Setup(s => s.AuthenticateStudentAsync(request.Email, request.Password, It.IsAny<CancellationToken>()))
            .ReturnsAsync(AuthResult.Failure("Invalid email or password."));

        // Act
        var result = await _controller.Login(request, CancellationToken.None);

        // Assert
        result.Should().BeOfType<UnauthorizedObjectResult>();
        var unauthorizedResult = (UnauthorizedObjectResult)result;
        unauthorizedResult.StatusCode.Should().Be(401);
    }

    [Fact]
    public async Task Login_ShouldReturn401_WhenRequestBodyIsNull()
    {
        // Act
        var result = await _controller.Login(null, CancellationToken.None);

        // Assert
        result.Should().BeOfType<UnauthorizedObjectResult>();
        var unauthorizedResult = (UnauthorizedObjectResult)result;
        unauthorizedResult.StatusCode.Should().Be(401);

        _authServiceMock.Verify(s => s.AuthenticateStudentAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Theory]
    [InlineData("", "pass")]
    [InlineData("   ", "pass")]
    [InlineData("student@miu.edu", "")]
    [InlineData("student@miu.edu", "   ")]
    public async Task Login_ShouldReturn401_WhenEmailOrPasswordIsEmptyOrWhitespace(string email, string password)
    {
        // Arrange
        var request = new LoginRequest(email, password);

        // Act
        var result = await _controller.Login(request, CancellationToken.None);

        // Assert
        result.Should().BeOfType<UnauthorizedObjectResult>();
        var unauthorizedResult = (UnauthorizedObjectResult)result;
        unauthorizedResult.StatusCode.Should().Be(401);

        _authServiceMock.Verify(s => s.AuthenticateStudentAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
